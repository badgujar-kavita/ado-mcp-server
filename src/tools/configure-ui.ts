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
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json() as { name: string; description?: string };
      return { 
        success: true, 
        message: "Connected successfully!", 
        details: `Project: ${data.name}` 
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

async function testConfluenceConnection(baseUrl: string, email: string, apiToken: string): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    const authHeader = `Basic ${Buffer.from(email + ":" + apiToken).toString("base64")}`;
    const url = `${cleanUrl}/rest/api/space?limit=1`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json() as { results?: Array<{ name: string }> };
      const spaceName = data.results?.[0]?.name || "Spaces accessible";
      return { success: true, message: "Connected successfully!", details: spaceName };
    }

    if (response.status === 401) {
      return { success: false, message: "Authentication failed", details: "Check email and API token" };
    }

    return { success: false, message: `Error (${response.status})`, details: await response.text() };
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ADO TestForge MCP - Configure</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --primary: #6366f1;
      --primary-dark: #4f46e5;
      --primary-light: #818cf8;
      --success: #10b981;
      --error: #ef4444;
      --warning: #f59e0b;
      --bg-dark: #0f0f23;
      --bg-card: #1a1a2e;
      --bg-input: #16162a;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --border: #334155;
      --glow: rgba(99, 102, 241, 0.4);
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-dark);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Animated background */
    .bg-animation {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      overflow: hidden;
    }

    .bg-animation::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(ellipse at center, rgba(99, 102, 241, 0.15) 0%, transparent 50%);
      animation: pulse 8s ease-in-out infinite;
    }

    .bg-animation::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: 
        radial-gradient(circle at 20% 80%, rgba(99, 102, 241, 0.1) 0%, transparent 40%),
        radial-gradient(circle at 80% 20%, rgba(16, 185, 129, 0.08) 0%, transparent 40%);
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.5; }
      50% { transform: scale(1.1) rotate(5deg); opacity: 0.8; }
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
      width: 4px;
      height: 4px;
      background: var(--primary-light);
      border-radius: 50%;
      opacity: 0.3;
      animation: float 15s infinite;
    }

    @keyframes float {
      0%, 100% { transform: translateY(100vh) scale(0); opacity: 0; }
      10% { opacity: 0.3; }
      90% { opacity: 0.3; }
      100% { transform: translateY(-100vh) scale(1); opacity: 0; }
    }

    /* Container */
    .container {
      max-width: 640px;
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
      margin-bottom: 2rem;
    }

    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      border-radius: 20px;
      margin-bottom: 1.5rem;
      position: relative;
      box-shadow: 0 0 40px var(--glow);
      animation: logoFloat 3s ease-in-out infinite;
    }

    @keyframes logoFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    .logo svg {
      width: 40px;
      height: 40px;
      color: white;
    }

    .logo::after {
      content: '';
      position: absolute;
      inset: -2px;
      background: linear-gradient(135deg, var(--primary-light), transparent, var(--primary));
      border-radius: 22px;
      z-index: -1;
      animation: rotate 4s linear infinite;
    }

    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    h1 {
      font-size: 1.875rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--text) 0%, var(--primary-light) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    /* Card */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.75rem;
      margin-bottom: 1rem;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--primary), var(--primary-light), var(--primary));
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .card:hover::before {
      opacity: 1;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .card-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card-icon svg {
      width: 22px;
      height: 22px;
      color: white;
    }

    .card-title {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .card-badge {
      margin-left: auto;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-required {
      background: rgba(99, 102, 241, 0.15);
      color: var(--primary-light);
    }

    .badge-optional {
      background: rgba(148, 163, 184, 0.15);
      color: var(--text-muted);
    }

    /* Form */
    .form-group {
      margin-bottom: 1rem;
    }

    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    input {
      width: 100%;
      padding: 0.875rem 1rem;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 0.95rem;
      transition: all 0.2s ease;
    }

    input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--glow);
    }

    input::placeholder {
      color: var(--text-muted);
      opacity: 0.6;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.875rem 1.5rem;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: white;
      box-shadow: 0 4px 15px var(--glow);
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px var(--glow);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--primary);
    }

    .btn-success {
      background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
      color: white;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }

    .btn-row {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    /* Status indicators */
    .status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      margin-top: 1rem;
      font-size: 0.875rem;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .status-success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
    }

    .status-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--error);
    }

    .status-loading {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: var(--primary-light);
    }

    .status-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
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
      margin-top: 0.25rem;
    }

    /* Footer */
    .footer {
      margin-top: 1.5rem;
      display: flex;
      justify-content: center;
    }

    .btn-save {
      min-width: 200px;
      padding: 1rem 2rem;
      font-size: 1rem;
    }

    /* Collapsible */
    .collapsible-header {
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    .collapsible-header svg {
      width: 20px;
      height: 20px;
      color: var(--text-muted);
      transition: transform 0.2s ease;
      margin-left: auto;
    }

    .collapsible-header.open svg {
      transform: rotate(180deg);
    }

    .collapsible-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .collapsible-content.open {
      max-height: 500px;
    }

    /* Success overlay */
    .success-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 15, 35, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
    }

    .success-overlay.show {
      opacity: 1;
      visibility: visible;
    }

    .success-content {
      text-align: center;
      animation: scaleIn 0.5s ease;
    }

    @keyframes scaleIn {
      from { transform: scale(0.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .success-icon {
      width: 100px;
      height: 100px;
      background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      box-shadow: 0 0 60px rgba(16, 185, 129, 0.4);
    }

    .success-icon svg {
      width: 50px;
      height: 50px;
      color: white;
      animation: checkmark 0.5s ease 0.2s forwards;
      stroke-dasharray: 50;
      stroke-dashoffset: 50;
    }

    @keyframes checkmark {
      to { stroke-dashoffset: 0; }
    }

    .success-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }

    .success-message {
      color: var(--text-muted);
      margin-bottom: 1.5rem;
    }

    /* Responsive */
    @media (max-width: 640px) {
      .container {
        padding: 1rem;
      }
      
      .card {
        padding: 1.25rem;
      }
      
      .btn-row {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="bg-animation"></div>
  <div class="particles" id="particles"></div>

  <div class="container">
    <div class="header">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <h1>ADO TestForge MCP</h1>
      <p class="subtitle">Configure your credentials securely</p>
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
        <div class="card-icon" style="background: linear-gradient(135deg, #0052CC 0%, #0747A6 100%);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <span class="card-title">Confluence</span>
        <span class="card-badge badge-optional">Optional</span>
        <svg id="confluence-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      <div id="confluence-content" class="collapsible-content">
        <div style="padding-top: 1rem;">
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
    // Create floating particles
    const particlesContainer = document.getElementById('particles');
    for (let i = 0; i < 20; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 15 + 's';
      particle.style.animationDuration = (15 + Math.random() * 10) + 's';
      particlesContainer.appendChild(particle);
    }

    let adoTested = false;

    function toggleConfluence() {
      const content = document.getElementById('confluence-content');
      const chevron = document.getElementById('confluence-chevron');
      const header = chevron.closest('.collapsible-header');
      
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
