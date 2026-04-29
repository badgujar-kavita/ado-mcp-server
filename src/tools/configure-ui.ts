import { createServer, IncomingMessage, ServerResponse } from "http";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { platform } from "os";

const CREDENTIALS_DIR = join(homedir(), ".ado-testforge-mcp");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

interface Credentials {
  ado_pat: string;
  ado_org: string;
  ado_project: string;
  confluence_base_url?: string;
  confluence_email?: string;
  confluence_api_token?: string;
}

function loadExistingCredentials(): Partial<Credentials> {
  if (!existsSync(CREDENTIALS_FILE)) return {};
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const data = JSON.parse(raw);
    const placeholders = ["your-personal-access-token", "your-organization-name", "your-project-name"];
    return {
      ado_pat: placeholders.includes(data.ado_pat) ? "" : data.ado_pat || "",
      ado_org: placeholders.includes(data.ado_org) ? "" : data.ado_org || "",
      ado_project: placeholders.includes(data.ado_project) ? "" : data.ado_project || "",
      confluence_base_url: data.confluence_base_url || "",
      confluence_email: data.confluence_email || "",
      confluence_api_token: data.confluence_api_token || "",
    };
  } catch {
    return {};
  }
}

async function testAdoConnection(pat: string, org: string, project: string): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    const authHeader = `Basic ${Buffer.from(":" + pat).toString("base64")}`;
    // Use the project API at organization level to verify access
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json() as { name: string; description?: string; state?: string };
      return { 
        success: true, 
        message: "Connected successfully!", 
        details: `Project: ${data.name}${data.state ? ` (${data.state})` : ""}` 
      };
    }

    if (response.status === 401) {
      return { success: false, message: "Authentication failed", details: "Check that your PAT is valid and not expired" };
    }
    if (response.status === 403) {
      return { success: false, message: "Access denied", details: "Ensure your PAT has Work Items and Test Management scopes" };
    }
    if (response.status === 404) {
      return { success: false, message: "Not found", details: "Verify the organization and project names" };
    }

    return { success: false, message: `Error (${response.status})`, details: await response.text() };
  } catch (err) {
    return { success: false, message: "Connection failed", details: String(err) };
  }
}

/** Extract site host from base URL, e.g. your-org.atlassian.net from https://your-org.atlassian.net/wiki */
function extractSiteHost(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return u.hostname;
  } catch {
    return null;
  }
}

/** Fetch cloud ID from tenant_info (no auth required) */
async function fetchCloudId(siteHost: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${siteHost}/_edge/tenant_info`);
    if (!res.ok) return null;
    const data = (await res.json()) as { cloudId?: string };
    return data.cloudId ?? null;
  } catch {
    return null;
  }
}

async function testConfluenceConnection(baseUrl: string, email: string, apiToken: string): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    const authHeader = `Basic ${Buffer.from(email + ":" + apiToken).toString("base64")}`;
    
    // Try the user/current endpoint first (simpler, works with most tokens)
    const userUrl = `${cleanUrl}/rest/api/user/current`;
    const userResponse = await fetch(userUrl, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (userResponse.ok) {
      const data = await userResponse.json() as { displayName?: string; username?: string };
      const userName = data.displayName || data.username || "User verified";
      return { success: true, message: "Connected successfully!", details: `User: ${userName}` };
    }

    // If user endpoint fails, try space list
    const spaceUrl = `${cleanUrl}/rest/api/space?limit=1`;
    const spaceResponse = await fetch(spaceUrl, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (spaceResponse.ok) {
      const data = await spaceResponse.json() as { results?: Array<{ name: string }> };
      const spaceName = data.results?.[0]?.name || "Spaces accessible";
      return { success: true, message: "Connected successfully!", details: spaceName };
    }

    // If 401, try the Atlassian Cloud API fallback (for scoped API tokens)
    if (userResponse.status === 401 || spaceResponse.status === 401) {
      const siteHost = extractSiteHost(cleanUrl);
      if (siteHost && siteHost.includes("atlassian.net")) {
        const cloudId = await fetchCloudId(siteHost);
        if (cloudId) {
          const cloudUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/rest/api/user/current`;
          const cloudResponse = await fetch(cloudUrl, {
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
            },
          });

          if (cloudResponse.ok) {
            const data = await cloudResponse.json() as { displayName?: string };
            return { success: true, message: "Connected via Cloud API!", details: data.displayName || "User verified" };
          }
        }
      }
      return { 
        success: false, 
        message: "Authentication failed", 
        details: "Check: (1) Email matches your Atlassian account, (2) API token is valid (create new at id.atlassian.com/manage-profile/security/api-tokens), (3) Base URL format: https://yoursite.atlassian.net/wiki" 
      };
    }

    const errorBody = await spaceResponse.text().catch(() => "");
    return { success: false, message: `Error (${spaceResponse.status})`, details: errorBody || "Unknown error" };
  } catch (err) {
    return { success: false, message: "Connection failed", details: String(err) };
  }
}

function saveCredentials(creds: Credentials): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  
  const data: Record<string, string> = {
    ado_pat: creds.ado_pat,
    ado_org: creds.ado_org,
    ado_project: creds.ado_project,
    confluence_base_url: creds.confluence_base_url || "",
    confluence_email: creds.confluence_email || "",
    confluence_api_token: creds.confluence_api_token || "",
  };
  
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function getHtmlContent(existingCreds: Partial<Credentials>): string {
  const currentYear = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ADO TestForge MCP - Configure</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --primary: #8b5cf6;
      --primary-dark: #7c3aed;
      --primary-light: #a78bfa;
      --primary-glow: rgba(139, 92, 246, 0.5);
      --secondary: #06b6d4;
      --secondary-dark: #0891b2;
      --accent: #f472b6;
      --accent-glow: rgba(244, 114, 182, 0.4);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.4);
      --error: #f43f5e;
      --error-glow: rgba(244, 63, 94, 0.4);
      --warning: #f59e0b;
      --bg-dark: #030712;
      --bg-darker: #000000;
      --bg-card: rgba(15, 23, 42, 0.6);
      --bg-card-hover: rgba(30, 41, 59, 0.7);
      --bg-input: rgba(15, 23, 42, 0.8);
      --text: #f1f5f9;
      --text-bright: #ffffff;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --border: rgba(148, 163, 184, 0.15);
      --border-hover: rgba(139, 92, 246, 0.5);
      --glass: rgba(255, 255, 255, 0.03);
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-dark);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
      line-height: 1.6;
    }

    /* Stunning animated background */
    .bg-animation {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -2;
      overflow: hidden;
      background: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 92, 246, 0.15), transparent),
        radial-gradient(ellipse 60% 40% at 100% 100%, rgba(6, 182, 212, 0.1), transparent),
        radial-gradient(ellipse 50% 30% at 0% 100%, rgba(244, 114, 182, 0.08), transparent),
        var(--bg-dark);
    }

    /* Animated mesh gradient */
    .mesh-gradient {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      opacity: 0.4;
      filter: blur(100px);
    }

    .mesh-gradient .blob {
      position: absolute;
      border-radius: 50%;
      animation: blobMove 20s ease-in-out infinite;
    }

    .mesh-gradient .blob-1 {
      width: 600px;
      height: 600px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
      top: -200px;
      left: -100px;
      animation-delay: 0s;
    }

    .mesh-gradient .blob-2 {
      width: 500px;
      height: 500px;
      background: linear-gradient(135deg, var(--accent) 0%, var(--primary) 100%);
      bottom: -150px;
      right: -100px;
      animation-delay: -5s;
    }

    .mesh-gradient .blob-3 {
      width: 400px;
      height: 400px;
      background: linear-gradient(135deg, var(--secondary) 0%, var(--accent) 100%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation-delay: -10s;
    }

    @keyframes blobMove {
      0%, 100% { transform: translate(0, 0) scale(1); }
      25% { transform: translate(50px, -30px) scale(1.05); }
      50% { transform: translate(-20px, 40px) scale(0.95); }
      75% { transform: translate(30px, 20px) scale(1.02); }
    }

    /* Floating particles */
    .particles {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      pointer-events: none;
    }

    .particle {
      position: absolute;
      border-radius: 50%;
      opacity: 0;
      animation: particleFloat 20s infinite;
    }

    .particle-glow {
      box-shadow: 0 0 10px currentColor, 0 0 20px currentColor;
    }

    @keyframes particleFloat {
      0% { 
        transform: translateY(100vh) translateX(0) scale(0);
        opacity: 0;
      }
      5% { opacity: 0.6; transform: translateY(90vh) translateX(10px) scale(1); }
      95% { opacity: 0.6; }
      100% { 
        transform: translateY(-20vh) translateX(-10px) scale(0.5);
        opacity: 0;
      }
    }

    /* Grid lines */
    .grid-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      background-image: 
        linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px);
      background-size: 60px 60px;
      mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, black, transparent);
    }

    /* Container */
    .container {
      max-width: 680px;
      margin: 0 auto;
      padding: 2rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    /* Header */
    .header {
      text-align: center;
      margin-bottom: 2.5rem;
      animation: fadeInDown 0.8s ease;
    }

    @keyframes fadeInDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .logo-container {
      position: relative;
      display: inline-block;
      margin-bottom: 1.75rem;
    }

    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 88px;
      height: 88px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 50%, var(--accent) 100%);
      border-radius: 24px;
      position: relative;
      box-shadow: 
        0 0 60px var(--primary-glow),
        0 20px 40px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
      animation: logoFloat 4s ease-in-out infinite;
      z-index: 1;
    }

    .logo::before {
      content: '';
      position: absolute;
      inset: -3px;
      background: linear-gradient(135deg, var(--primary-light), var(--accent), var(--secondary), var(--primary));
      border-radius: 26px;
      z-index: -1;
      animation: borderRotate 6s linear infinite;
      opacity: 0.7;
    }

    .logo::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%);
      border-radius: 24px;
    }

    @keyframes logoFloat {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-12px) rotate(2deg); }
    }

    @keyframes borderRotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .logo svg {
      width: 44px;
      height: 44px;
      color: white;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
    }

    .logo-rings {
      position: absolute;
      inset: -20px;
      border: 1px solid rgba(139, 92, 246, 0.2);
      border-radius: 50%;
      animation: ringPulse 3s ease-in-out infinite;
    }

    .logo-rings:nth-child(2) {
      inset: -35px;
      animation-delay: 0.5s;
      border-color: rgba(139, 92, 246, 0.15);
    }

    .logo-rings:nth-child(3) {
      inset: -50px;
      animation-delay: 1s;
      border-color: rgba(139, 92, 246, 0.1);
    }

    @keyframes ringPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.5; }
    }

    h1 {
      font-size: 2.25rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--text-bright) 0%, var(--primary-light) 50%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 1.05rem;
      font-weight: 400;
    }

    .subtitle span {
      color: var(--primary-light);
    }

    /* Card */
    .card {
      background: var(--bg-card);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 2rem;
      margin-bottom: 1.25rem;
      position: relative;
      overflow: hidden;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      animation: cardFadeIn 0.6s ease forwards;
      opacity: 0;
    }

    .card:nth-child(1) { animation-delay: 0.1s; }
    .card:nth-child(2) { animation-delay: 0.2s; }

    @keyframes cardFadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--primary-light), var(--accent), transparent);
      opacity: 0;
      transition: opacity 0.4s ease;
    }

    .card::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, var(--glass) 0%, transparent 100%);
      pointer-events: none;
    }

    .card:hover {
      border-color: var(--border-hover);
      background: var(--bg-card-hover);
      transform: translateY(-4px);
      box-shadow: 
        0 25px 50px rgba(0, 0, 0, 0.3),
        0 0 40px var(--primary-glow);
    }

    .card:hover::before {
      opacity: 1;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .card-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      box-shadow: 0 8px 20px var(--primary-glow);
    }

    .card-icon::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 50%);
      border-radius: 14px;
    }

    .card-icon svg {
      width: 24px;
      height: 24px;
      color: white;
    }

    .card-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-bright);
    }

    .card-badge {
      margin-left: auto;
      padding: 0.35rem 1rem;
      border-radius: 20px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .badge-required {
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(244, 114, 182, 0.2));
      color: var(--primary-light);
      border: 1px solid rgba(139, 92, 246, 0.3);
    }

    .badge-optional {
      background: rgba(148, 163, 184, 0.1);
      color: var(--text-muted);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }

    /* Form */
    .form-group {
      margin-bottom: 1.25rem;
    }

    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      transition: color 0.2s ease;
    }

    .form-group:focus-within label {
      color: var(--primary-light);
    }

    input {
      width: 100%;
      padding: 1rem 1.25rem;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      font-size: 0.95rem;
      font-family: inherit;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    input:hover {
      border-color: rgba(139, 92, 246, 0.3);
    }

    input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 
        0 0 0 4px var(--primary-glow),
        0 4px 20px rgba(0, 0, 0, 0.2);
      background: rgba(15, 23, 42, 0.9);
    }

    input::placeholder {
      color: var(--text-dim);
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.875rem 1.5rem;
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: none;
      position: relative;
      overflow: hidden;
    }

    .btn::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .btn:hover::before {
      opacity: 1;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: white;
      box-shadow: 
        0 8px 25px var(--primary-glow),
        0 2px 10px rgba(0, 0, 0, 0.2);
    }

    .btn-primary:hover {
      transform: translateY(-3px);
      box-shadow: 
        0 15px 35px var(--primary-glow),
        0 5px 15px rgba(0, 0, 0, 0.3);
    }

    .btn-primary:active {
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.3);
      color: var(--primary-light);
    }

    .btn-secondary:hover {
      background: rgba(139, 92, 246, 0.2);
      border-color: var(--primary);
      box-shadow: 0 8px 25px rgba(139, 92, 246, 0.2);
    }

    .btn-success {
      background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
      color: white;
      box-shadow: 0 8px 25px var(--success-glow);
    }

    .btn-success:hover {
      transform: translateY(-3px);
      box-shadow: 0 15px 35px var(--success-glow);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }

    .btn-row {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.25rem;
    }

    /* Status indicators */
    .status {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      border-radius: 14px;
      margin-top: 1.25rem;
      font-size: 0.9rem;
      animation: statusSlide 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes statusSlide {
      from { opacity: 0; transform: translateY(-15px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .status-success {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05));
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
    }

    .status-error {
      background: linear-gradient(135deg, rgba(244, 63, 94, 0.15), rgba(244, 63, 94, 0.05));
      border: 1px solid rgba(244, 63, 94, 0.3);
      color: var(--error);
    }

    .status-loading {
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05));
      border: 1px solid rgba(139, 92, 246, 0.3);
      color: var(--primary-light);
    }

    .status-icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .spinner {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .status-details {
      color: var(--text-muted);
      font-size: 0.8rem;
      margin-top: 0.35rem;
      line-height: 1.5;
    }

    /* Footer with save button */
    .footer {
      margin-top: 2rem;
      display: flex;
      justify-content: center;
      animation: fadeInUp 0.6s ease 0.3s forwards;
      opacity: 0;
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .btn-save {
      min-width: 240px;
      padding: 1.125rem 2.5rem;
      font-size: 1.05rem;
      border-radius: 14px;
    }

    /* Collapsible */
    .collapsible-header {
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }

    .collapsible-header:hover .card-title {
      color: var(--primary-light);
    }

    .collapsible-header .chevron {
      width: 22px;
      height: 22px;
      color: var(--text-muted);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-left: auto;
    }

    .collapsible-header.open .chevron {
      transform: rotate(180deg);
      color: var(--primary-light);
    }

    .collapsible-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .collapsible-content.open {
      max-height: 600px;
    }

    /* Success overlay */
    .success-overlay {
      position: fixed;
      inset: 0;
      background: rgba(3, 7, 18, 0.97);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(10px);
    }

    .success-overlay.show {
      opacity: 1;
      visibility: visible;
    }

    .success-content {
      text-align: center;
      animation: successPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes successPop {
      from { transform: scale(0.5); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .success-icon {
      width: 120px;
      height: 120px;
      background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 2rem;
      box-shadow: 
        0 0 80px var(--success-glow),
        0 20px 40px rgba(0, 0, 0, 0.3);
      position: relative;
    }

    .success-icon::before {
      content: '';
      position: absolute;
      inset: -10px;
      border: 2px solid rgba(16, 185, 129, 0.3);
      border-radius: 50%;
      animation: successRing 2s ease-out infinite;
    }

    @keyframes successRing {
      0% { transform: scale(1); opacity: 1; }
      100% { transform: scale(1.5); opacity: 0; }
    }

    .success-icon svg {
      width: 60px;
      height: 60px;
      color: white;
      animation: checkmarkDraw 0.6s ease 0.3s forwards;
      stroke-dasharray: 60;
      stroke-dashoffset: 60;
    }

    @keyframes checkmarkDraw {
      to { stroke-dashoffset: 0; }
    }

    .success-title {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      background: linear-gradient(135deg, var(--text-bright), var(--success));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .success-message {
      color: var(--text-muted);
      margin-bottom: 2rem;
      font-size: 1.05rem;
    }

    /* Copyright footer */
    .copyright {
      text-align: center;
      padding: 2rem 0 1rem;
      color: var(--text-dim);
      font-size: 0.8rem;
      animation: fadeIn 0.6s ease 0.5s forwards;
      opacity: 0;
    }

    @keyframes fadeIn {
      to { opacity: 1; }
    }

    .copyright a {
      color: var(--primary-light);
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .copyright a:hover {
      color: var(--accent);
    }

    .copyright .heart {
      display: inline-block;
      color: var(--accent);
      animation: heartbeat 1.5s ease infinite;
    }

    @keyframes heartbeat {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    /* Responsive */
    @media (max-width: 640px) {
      .container {
        padding: 1.25rem;
      }
      
      .card {
        padding: 1.5rem;
        border-radius: 16px;
      }
      
      h1 {
        font-size: 1.75rem;
      }

      .logo {
        width: 72px;
        height: 72px;
      }
      
      .btn-row {
        flex-direction: column;
      }

      .btn-save {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="bg-animation"></div>
  <div class="mesh-gradient">
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
  </div>
  <div class="grid-overlay"></div>
  <div class="particles" id="particles"></div>

  <div class="container">
    <div class="header">
      <div class="logo-container">
        <div class="logo-rings"></div>
        <div class="logo-rings"></div>
        <div class="logo-rings"></div>
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
      </div>
      <h1>ADO TestForge MCP</h1>
      <p class="subtitle">Configure your credentials <span>securely</span></p>
    </div>

    <!-- ADO Section -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <span class="card-title">Azure DevOps</span>
        <span class="card-badge badge-required">Required</span>
      </div>

      <div class="form-group">
        <label for="ado_pat">Personal Access Token (PAT)</label>
        <input type="password" id="ado_pat" placeholder="Enter your ADO PAT" value="${existingCreds.ado_pat || ""}">
      </div>

      <div class="form-group">
        <label for="ado_org">Organization</label>
        <input type="text" id="ado_org" placeholder="e.g., YourOrgName" value="${existingCreds.ado_org || ""}">
      </div>

      <div class="form-group">
        <label for="ado_project">Project</label>
        <input type="text" id="ado_project" placeholder="e.g., YourProjectName" value="${existingCreds.ado_project || ""}">
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-secondary" onclick="testAdo()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          Test Connection
        </button>
      </div>

      <div id="ado-status"></div>
    </div>

    <!-- Confluence Section -->
    <div class="card">
      <div class="card-header collapsible-header" onclick="toggleConfluence()">
        <div class="card-icon" style="background: linear-gradient(135deg, #0052CC 0%, #0747A6 100%); box-shadow: 0 8px 20px rgba(0, 82, 204, 0.4);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <span class="card-title">Confluence</span>
        <span class="card-badge badge-optional">Optional</span>
        <svg class="chevron" id="confluence-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      <div id="confluence-content" class="collapsible-content">
        <div style="padding-top: 1.25rem;">
          <div class="form-group">
            <label for="confluence_base_url">Base URL</label>
            <input type="text" id="confluence_base_url" placeholder="https://your-org.atlassian.net/wiki" value="${existingCreds.confluence_base_url || ""}">
          </div>

          <div class="form-group">
            <label for="confluence_email">Email</label>
            <input type="email" id="confluence_email" placeholder="your.email@company.com" value="${existingCreds.confluence_email || ""}">
          </div>

          <div class="form-group">
            <label for="confluence_api_token">API Token</label>
            <input type="password" id="confluence_api_token" placeholder="Enter your Confluence API token" value="${existingCreds.confluence_api_token || ""}">
          </div>

          <div class="btn-row">
            <button type="button" class="btn btn-secondary" onclick="testConfluence()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              Test Connection
            </button>
          </div>

          <div id="confluence-status"></div>
        </div>
      </div>
    </div>

    <div class="footer">
      <button type="button" class="btn btn-primary btn-save" id="save-btn" onclick="saveCredentials()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        Save Configuration
      </button>
    </div>

    <div class="copyright">
      Made with <span class="heart">&#10084;</span> by <a href="#">Kavita Badgujar</a><br>
      &copy; ${currentYear} ADO TestForge MCP. All rights reserved.
    </div>
  </div>

  <!-- Success Overlay -->
  <div class="success-overlay" id="success-overlay">
    <div class="success-content">
      <div class="success-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <h2 class="success-title">Configuration Saved!</h2>
      <p class="success-message">Restart Cursor IDE to apply changes</p>
      <button type="button" class="btn btn-success" onclick="window.close()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
        Close Window
      </button>
    </div>
  </div>

  <script>
    // Create floating particles with variety
    const particlesContainer = document.getElementById('particles');
    const colors = ['#8b5cf6', '#06b6d4', '#f472b6', '#a78bfa', '#10b981'];
    
    for (let i = 0; i < 30; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle' + (Math.random() > 0.5 ? ' particle-glow' : '');
      const size = 2 + Math.random() * 4;
      particle.style.width = size + 'px';
      particle.style.height = size + 'px';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.color = colors[Math.floor(Math.random() * colors.length)];
      particle.style.background = particle.style.color;
      particle.style.animationDelay = Math.random() * 20 + 's';
      particle.style.animationDuration = (15 + Math.random() * 15) + 's';
      particlesContainer.appendChild(particle);
    }

    let adoTested = false;

    function toggleConfluence() {
      const content = document.getElementById('confluence-content');
      const header = document.querySelector('.collapsible-header');
      
      content.classList.toggle('open');
      header.classList.toggle('open');
    }

    function showStatus(elementId, type, message, details) {
      const container = document.getElementById(elementId);
      
      let icon = '';
      if (type === 'success') {
        icon = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      } else if (type === 'error') {
        icon = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      } else if (type === 'loading') {
        icon = '<svg class="status-icon spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
      }

      container.innerHTML = \`
        <div class="status status-\${type}">
          \${icon}
          <div>
            <div>\${message}</div>
            \${details ? '<div class="status-details">' + details + '</div>' : ''}
          </div>
        </div>
      \`;
    }

    async function testAdo() {
      const pat = document.getElementById('ado_pat').value.trim();
      const org = document.getElementById('ado_org').value.trim();
      const project = document.getElementById('ado_project').value.trim();

      if (!pat || !org || !project) {
        showStatus('ado-status', 'error', 'Missing fields', 'Please fill in all required fields');
        return;
      }

      showStatus('ado-status', 'loading', 'Testing connection...');

      try {
        const res = await fetch('/api/test-ado', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pat, org, project })
        });
        const data = await res.json();

        if (data.success) {
          showStatus('ado-status', 'success', data.message, data.details);
          adoTested = true;
        } else {
          showStatus('ado-status', 'error', data.message, data.details);
          adoTested = false;
        }
      } catch (err) {
        showStatus('ado-status', 'error', 'Request failed', err.message);
        adoTested = false;
      }
    }

    async function testConfluence() {
      const baseUrl = document.getElementById('confluence_base_url').value.trim();
      const email = document.getElementById('confluence_email').value.trim();
      const apiToken = document.getElementById('confluence_api_token').value.trim();

      if (!baseUrl || !email || !apiToken) {
        showStatus('confluence-status', 'error', 'Missing fields', 'Please fill in all Confluence fields');
        return;
      }

      showStatus('confluence-status', 'loading', 'Testing connection...');

      try {
        const res = await fetch('/api/test-confluence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl, email, apiToken })
        });
        const data = await res.json();

        if (data.success) {
          showStatus('confluence-status', 'success', data.message, data.details);
        } else {
          showStatus('confluence-status', 'error', data.message, data.details);
        }
      } catch (err) {
        showStatus('confluence-status', 'error', 'Request failed', err.message);
      }
    }

    async function saveCredentials() {
      const pat = document.getElementById('ado_pat').value.trim();
      const org = document.getElementById('ado_org').value.trim();
      const project = document.getElementById('ado_project').value.trim();

      if (!pat || !org || !project) {
        showStatus('ado-status', 'error', 'Missing fields', 'Please fill in all required ADO fields');
        return;
      }

      const btn = document.getElementById('save-btn');
      btn.disabled = true;
      btn.innerHTML = '<svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving...';

      const credentials = {
        ado_pat: pat,
        ado_org: org,
        ado_project: project,
        confluence_base_url: document.getElementById('confluence_base_url').value.trim(),
        confluence_email: document.getElementById('confluence_email').value.trim(),
        confluence_api_token: document.getElementById('confluence_api_token').value.trim()
      };

      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials)
        });
        const data = await res.json();

        if (data.success) {
          document.getElementById('success-overlay').classList.add('show');
        } else {
          showStatus('ado-status', 'error', 'Save failed', data.message);
          btn.disabled = false;
          btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Configuration';
        }
      } catch (err) {
        showStatus('ado-status', 'error', 'Request failed', err.message);
        btn.disabled = false;
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Configuration';
      }
    }
  </script>
</body>
</html>`;
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, data: object, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" 
    ? `open "${url}"` 
    : platform() === "win32" 
      ? `start "${url}"` 
      : `xdg-open "${url}"`;
  exec(cmd);
}

export async function startConfigServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = req.url || "/";
      const method = req.method || "GET";

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        if (url === "/" && method === "GET") {
          const existingCreds = loadExistingCredentials();
          sendHtml(res, getHtmlContent(existingCreds));
        } else if (url === "/api/test-ado" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await testAdoConnection(body.pat, body.org, body.project);
          sendJson(res, result);
        } else if (url === "/api/test-confluence" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await testConfluenceConnection(body.baseUrl, body.email, body.apiToken);
          sendJson(res, result);
        } else if (url === "/api/save" && method === "POST") {
          const body = JSON.parse(await parseBody(req)) as Credentials;
          saveCredentials(body);
          sendJson(res, { success: true, message: "Credentials saved" });
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      } catch (err) {
        sendJson(res, { success: false, message: String(err) }, 500);
      }
    });

    // Find available port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        resolve({
          port,
          close: () => server.close(),
        });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    server.on("error", reject);
  });
}

export async function launchConfigUI(): Promise<string> {
  const { port, close } = await startConfigServer();
  const url = `http://127.0.0.1:${port}`;
  
  openBrowser(url);

  // Auto-close after 10 minutes
  setTimeout(() => {
    close();
  }, 10 * 60 * 1000);

  return url;
}
