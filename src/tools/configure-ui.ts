import { createServer, IncomingMessage, ServerResponse } from "http";
import { writeFileSync, existsSync, readFileSync, mkdirSync, accessSync, constants } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { platform } from "os";
import { basicAuthHeader } from "../helpers/basic-auth.ts";
import { keychain } from "../keychain/keychain.ts";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "../config/schema.ts";

// Legacy global path retained for migration READS only. New writes always go
// to the per-workspace location.
const LEGACY_CREDS_DIR = join(homedir(), ".vortex-ado");
const LEGACY_CREDS_FILE = join(LEGACY_CREDS_DIR, "credentials.json");

interface Credentials {
  ado_pat: string;
  ado_org: string;
  ado_project: string;
  confluence_base_url?: string;
  confluence_email?: string;
  confluence_api_token?: string;
}

/**
 * Per-workspace config paths computed from an explicit workspace root.
 *
 * The workspace root MUST be passed in. Cursor's MCP launches don't reliably
 * set process.cwd() to the open folder — the agent passes the workspace path
 * explicitly via the tool's `workspaceRoot` argument (or in the future, via
 * the MCP roots/list protocol). See workspace/resolve.ts for the full rules.
 */
function workspaceDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".vortex-ado");
}
function workspaceConfigFile(workspaceRoot: string): string {
  return join(workspaceDir(workspaceRoot), "config.json");
}

/**
 * Defensive check before auto-creating .vortex-ado/ in the supplied workspace
 * root. Refuses to write into:
 *   - the user's home directory (~)
 *   - non-writable paths
 *   - paths that don't exist
 *
 * The agent should never pass home or a non-project path — but this guard
 * exists so a typo or buggy client doesn't pollute the user's home directory.
 */
function isWorkspaceSafeForWrite(
  workspaceRoot: string,
): { ok: true } | { ok: false; reason: string } {
  const home = homedir();

  if (workspaceRoot === home) {
    return {
      ok: false,
      reason:
        "Workspace root is your home directory. Open a project folder in Cursor first, then run /ado-connect from there.",
    };
  }
  if (!existsSync(workspaceRoot)) {
    return {
      ok: false,
      reason: `Workspace root does not exist: ${workspaceRoot}`,
    };
  }
  try {
    accessSync(workspaceRoot, constants.W_OK);
  } catch {
    return { ok: false, reason: `Workspace root is not writable: ${workspaceRoot}` };
  }
  return { ok: true };
}

/**
 * Load existing per-workspace config (preferred) for re-runs of the wizard.
 * Falls back to the legacy global file ONLY for first-time migrations from
 * pre-Phase-1 installs — values are read but new writes go to workspace.
 *
 * Returns plain Partial<Credentials> shape used to pre-fill form fields.
 * The PAT/Confluence-token are pulled from keychain when org+project are
 * known so the user sees "(stored in keychain)" rather than a blank field.
 */
async function loadExistingCredentials(workspaceRoot: string): Promise<Partial<Credentials> & { _patStored?: boolean; _confluenceTokenStored?: boolean }> {
  // 1. Try per-workspace config + keychain.
  const wsFile = workspaceConfigFile(workspaceRoot);
  if (existsSync(wsFile)) {
    try {
      const raw = JSON.parse(readFileSync(wsFile, "utf-8"));
      const ws = WorkspaceConfigSchema.parse(raw);
      if (ws.ado?.org && ws.ado?.project) {
        const pat = await keychain.getAdoToken(ws.ado.org, ws.ado.project);
        const confluenceToken = await keychain.getConfluenceToken(ws.ado.org, ws.ado.project);
        return {
          ado_pat: "", // never pre-fill the PAT itself; UI shows "(stored)" indicator
          ado_org: ws.ado.org,
          ado_project: ws.ado.project,
          confluence_base_url: ws.confluence?.url ?? "",
          confluence_email: ws.confluence?.email ?? "",
          confluence_api_token: "",
          _patStored: pat !== null && pat.length > 0,
          _confluenceTokenStored: confluenceToken !== null && confluenceToken.length > 0,
        };
      }
    } catch {
      // Malformed workspace config — fall through to legacy.
    }
  }

  // 2. Migration fallback — read from legacy global credentials.json so
  // the user can review and re-save into the new workspace location.
  if (existsSync(LEGACY_CREDS_FILE)) {
    try {
      const raw = readFileSync(LEGACY_CREDS_FILE, "utf-8");
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

  return {};
}

async function testAdoConnection(pat: string, org: string, project: string): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    const authHeader = basicAuthHeader("", pat);
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
    const authHeader = basicAuthHeader(email, apiToken);
    
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

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — backend probe functions for the Conventions tab.
//
// These let the wizard populate Tab 2's plan-mapping list, persona-field
// dropdowns, and sprint-prefix suggestion automatically by querying the
// authenticated ADO project. Each probe takes the credentials it needs
// and returns a discriminated-union result {ok|notOk} so the frontend can
// render either a populated form or a graceful fallback.
//
// Auth: the wizard reads the PAT from the OS keychain (returning user) or
// uses the just-typed-but-not-yet-saved PAT (first-time user). Either way,
// the PAT is passed in here as a function arg.
// ─────────────────────────────────────────────────────────────────────────

interface ProbedPlan {
  planId: number;
  name: string;
  areaPath: string;
  /** Auto-suggested fragment derived from the plan's areaPath (last segment). */
  suggestedFragment: string;
}

interface ProbeResult<T> {
  ok: boolean;
  message?: string;
  data?: T;
}

/**
 * GET /_apis/testplan/Plans — list all test plans the PAT can see.
 * Used to populate Tab 2's plan-mapping picker.
 */
export async function probeAdoPlans(
  pat: string,
  org: string,
  project: string,
): Promise<ProbeResult<ProbedPlan[]>> {
  try {
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/testplan/plans?api-version=7.1`;
    const response = await fetch(url, {
      headers: {
        Authorization: basicAuthHeader("", pat),
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return { ok: false, message: `ADO returned ${response.status}: ${await response.text().catch(() => "")}` };
    }
    const json = (await response.json()) as { value?: Array<{ id: number; name: string; areaPath?: string }> };
    const plans: ProbedPlan[] = (json.value ?? []).map((p) => ({
      planId: p.id,
      name: p.name,
      areaPath: p.areaPath ?? "",
      // The "fragment" the user maps to a plan is whatever distinguishes its
      // area path from siblings. The last segment is a sensible auto-suggest;
      // the user can edit it in the wizard.
      suggestedFragment: extractAreaPathFragment(p.areaPath ?? "", project),
    }));
    return { ok: true, data: plans };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Extract a sensible AreaPath fragment for the testPlanMapping.
 *
 * If areaPath = "MyProject\Team\DHub", we want "DHub" (the leaf segment),
 * not "MyProject" (always shared across the project's plans).
 *
 * Falls back to the full areaPath when it's a single segment, or empty.
 */
function extractAreaPathFragment(areaPath: string, _project: string): string {
  if (!areaPath) return "";
  // ADO area paths use backslash separators.
  const segments = areaPath.split("\\").filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0];
  // Use the leaf segment — it's the most specific and discriminating.
  return segments[segments.length - 1];
}

/**
 * GET /_apis/wit/fields — list all work-item fields the PAT can see.
 * Returns prereq + solutionDesign + additionalContext candidates separately
 * so the frontend can populate the right dropdown.
 */
interface ProbedField {
  referenceName: string; // e.g. "Custom.PrerequisiteforTest"
  name: string; // human label, e.g. "Prerequisite for Test"
  type: string; // e.g. "html", "string"
}

interface ProbedFields {
  prerequisiteCandidates: ProbedField[];
  solutionDesignCandidates: ProbedField[];
  /** All Custom.* fields with html or PlainText type — useful for additionalContextFields multi-select. */
  contextCandidates: ProbedField[];
}

export async function probeAdoFields(
  pat: string,
  org: string,
  project: string,
): Promise<ProbeResult<ProbedFields>> {
  try {
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/fields?api-version=7.1`;
    const response = await fetch(url, {
      headers: {
        Authorization: basicAuthHeader("", pat),
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return { ok: false, message: `ADO returned ${response.status}: ${await response.text().catch(() => "")}` };
    }
    const json = (await response.json()) as {
      value?: Array<{ referenceName: string; name: string; type: string }>;
    };
    const all = json.value ?? [];

    // Filter helpers — the wizard surfaces only candidates that look likely
    // to be the right field for each role.
    const prerequisiteCandidates = all.filter(
      (f) =>
        /pre-?requisite|prereq/i.test(f.name) ||
        /pre-?requisite|prereq/i.test(f.referenceName),
    );
    const solutionDesignCandidates = all.filter(
      (f) =>
        /solution|technical|design|spec/i.test(f.name) ||
        /solution|technical|design|spec/i.test(f.referenceName),
    );
    const contextCandidates = all.filter(
      (f) =>
        f.referenceName.startsWith("Custom.") &&
        (f.type === "html" || f.type === "plainText" || f.type === "string"),
    );

    return {
      ok: true,
      data: {
        prerequisiteCandidates,
        solutionDesignCandidates,
        contextCandidates,
      },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * GET /_apis/wit/classificationnodes/Iterations — fetch the iteration tree
 * to suggest a sprint prefix. We look at leaf iteration names and find the
 * common prefix (e.g. "Sprint_1", "Sprint_2" → "Sprint_").
 *
 * Returns the most-common prefix found, or null if no obvious pattern.
 */
export async function probeIterationPrefix(
  pat: string,
  org: string,
  project: string,
): Promise<ProbeResult<{ suggestedPrefix: string | null; samples: string[] }>> {
  try {
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/Iterations?$depth=10&api-version=7.1`;
    const response = await fetch(url, {
      headers: {
        Authorization: basicAuthHeader("", pat),
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return { ok: false, message: `ADO returned ${response.status}: ${await response.text().catch(() => "")}` };
    }
    const json = (await response.json()) as {
      name?: string;
      children?: Array<unknown>;
    };

    // Walk the tree, collect leaf names.
    const leafNames: string[] = [];
    const walk = (node: { name?: string; children?: Array<unknown> }) => {
      const children = node.children;
      if (!children || children.length === 0) {
        if (node.name) leafNames.push(node.name);
        return;
      }
      for (const child of children) walk(child as { name?: string; children?: Array<unknown> });
    };
    walk(json);

    // Find a common prefix that ends in a separator before digits — like
    // "Sprint_", "Iteration_", custom prefixes. Pattern: ^([A-Za-z_-]+?)\d+$
    const prefixHits = new Map<string, number>();
    for (const name of leafNames) {
      const match = name.match(/^([A-Za-z][A-Za-z0-9_\- ]*?[_\- ])\d+$/);
      if (match) {
        const p = match[1];
        prefixHits.set(p, (prefixHits.get(p) ?? 0) + 1);
      }
    }
    const sorted = [...prefixHits.entries()].sort((a, b) => b[1] - a[1]);
    const suggestedPrefix = sorted.length > 0 ? sorted[0][0] : null;

    return {
      ok: true,
      data: {
        suggestedPrefix,
        samples: leafNames.slice(0, 8),
      },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Silently revalidate the PAT stored in keychain for a workspace.
 *
 * Used by Tab 2 on activation: if the user is a returning visitor and has
 * a PAT in keychain for the workspace's org/project, this confirms the
 * PAT is still good before unlocking Tab 2's probes.
 *
 * Returns { ok, pat? } — when ok=true, the caller has a verified PAT to
 * reuse for further probes without re-prompting the user.
 */
async function checkKeychainPat(
  workspaceRoot: string,
): Promise<{ ok: boolean; message?: string; pat?: string; org?: string; project?: string }> {
  const wsFile = workspaceConfigFile(workspaceRoot);
  if (!existsSync(wsFile)) {
    return { ok: false, message: "No workspace config found. Save your connection first." };
  }
  let parsed;
  try {
    parsed = WorkspaceConfigSchema.parse(JSON.parse(readFileSync(wsFile, "utf-8")));
  } catch (err) {
    return { ok: false, message: `Workspace config could not be parsed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!parsed.ado?.org || !parsed.ado?.project) {
    return { ok: false, message: "Workspace config has no ADO org/project. Save your connection first." };
  }
  const pat = await keychain.getAdoToken(parsed.ado.org, parsed.ado.project);
  if (!pat) {
    return { ok: false, message: "No PAT found in OS keychain for this workspace. Re-save your connection." };
  }
  // Verify the PAT against ADO. Reuse testAdoConnection's auth check.
  const test = await testAdoConnection(pat, parsed.ado.org, parsed.ado.project);
  if (!test.success) {
    return { ok: false, message: `Saved PAT is no longer valid: ${test.message}. Update it on the Connection tab.` };
  }
  return { ok: true, pat, org: parsed.ado.org, project: parsed.ado.project };
}

/**
 * Save the wizard's submission to per-workspace config + OS keychain.
 *
 * Flow:
 *   1. Verify cwd is a safe writable project folder.
 *   2. Load existing workspace config (if any) so non-credential fields
 *      (testCaseTitle.prefix, personas, plan mappings, …) are preserved
 *      across re-runs. Per the design: re-running the wizard updates only
 *      the credential-related fields.
 *   3. If org/project are CHANGING vs the existing config, log a warning
 *      AND clean up the previous keychain entry so it isn't orphaned.
 *   4. Write the merged config to <workspace>/.vortex-ado/config.json.
 *   5. Write the PAT to keychain at vortex-ado/ado::{org}::{project}.
 *   6. Write the Confluence token to keychain (if provided).
 *
 * Throws on any safety failure — caller surfaces to the wizard UI.
 */
async function saveCredentials(
  creds: Credentials,
  workspaceRoot: string,
): Promise<{ workspaceConfigPath: string; orgProjectChanged: boolean }> {
  const safety = isWorkspaceSafeForWrite(workspaceRoot);
  if (!safety.ok) {
    throw new Error(`Cannot save: ${safety.reason}`);
  }

  const wsDir = workspaceDir(workspaceRoot);
  const wsFile = workspaceConfigFile(workspaceRoot);
  if (!existsSync(wsDir)) {
    mkdirSync(wsDir, { recursive: true });
  }

  // Load existing config to preserve non-credential fields on re-run.
  let existingConfig: WorkspaceConfig | null = null;
  let previousOrg: string | undefined;
  let previousProject: string | undefined;
  if (existsSync(wsFile)) {
    try {
      const raw = JSON.parse(readFileSync(wsFile, "utf-8"));
      existingConfig = WorkspaceConfigSchema.parse(raw);
      previousOrg = existingConfig.ado?.org;
      previousProject = existingConfig.ado?.project;
    } catch {
      // Malformed existing config — overwrite from scratch. The user is
      // explicitly re-running the wizard so this is intentional.
      existingConfig = null;
    }
  }

  const orgProjectChanged =
    previousOrg !== undefined &&
    previousProject !== undefined &&
    (previousOrg !== creds.ado_org || previousProject !== creds.ado_project);

  // Merge: keep existing non-credential blocks, overwrite ado/confluence.
  const merged: WorkspaceConfig = {
    ...(existingConfig ?? { version: 1 }),
    version: 1,
    ado: {
      url: `https://dev.azure.com/${creds.ado_org}`,
      org: creds.ado_org,
      project: creds.ado_project,
      setupAt: new Date().toISOString(),
      ...(existingConfig?.ado?.fieldRefs ? { fieldRefs: existingConfig.ado.fieldRefs } : {}),
    },
    ...(creds.confluence_base_url || creds.confluence_email
      ? {
          confluence: {
            enabled: Boolean(creds.confluence_base_url && creds.confluence_email),
            ...(creds.confluence_base_url ? { url: creds.confluence_base_url } : {}),
            ...(creds.confluence_email ? { email: creds.confluence_email } : {}),
          },
        }
      : existingConfig?.confluence
        ? { confluence: existingConfig.confluence }
        : {}),
  };

  writeFileSync(wsFile, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  // Keychain: store the PAT under (org, project). If org/project changed,
  // delete the old keychain entry so it isn't orphaned.
  if (orgProjectChanged && previousOrg && previousProject) {
    try {
      await keychain.deleteAdoToken(previousOrg, previousProject);
      await keychain.deleteConfluenceToken(previousOrg, previousProject);
    } catch {
      // Best-effort cleanup; don't block save if delete fails.
    }
  }

  if (creds.ado_pat) {
    await keychain.setAdoToken(creds.ado_org, creds.ado_project, creds.ado_pat);
  }
  if (creds.confluence_api_token) {
    await keychain.setConfluenceToken(
      creds.ado_org,
      creds.ado_project,
      creds.confluence_api_token,
    );
  }

  return { workspaceConfigPath: wsFile, orgProjectChanged };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — Save Conventions (Tab 2).
//
// Independent of saveCredentials. Touches workspace config only — never
// keychain, never the `ado` or `confluence` blocks. The user can update
// conventions without re-entering their PAT, and updating conventions
// never invalidates their keychain entry.
// ─────────────────────────────────────────────────────────────────────────

interface ConventionsPayload {
  /** sprintPrefix override; framework default is "Sprint_" but sanitized bundle ships "Sprint_". */
  sprintPrefix?: string;
  /** Plan mappings (testPlanMapping). Empty array means "clear all mappings". */
  testPlanMapping?: Array<{ planId: number; areaPathContains: string[] }>;
  /** Personas keyed by id (e.g. "Cashier"). Empty object means "clear all". */
  personas?: Record<
    string,
    {
      label: string;
      profile: string;
      user?: string;
      roles: string;
      psg: string;
    }
  >;
  /** ADO custom field for prereq HTML (e.g. "Custom.PrerequisiteforTest"). */
  prerequisiteFieldRef?: string;
  /** ADO custom field for Solution Design (e.g. "Custom.TechnicalSolution"). */
  solutionDesignFieldRef?: string;
  /** Additional context fields the agent should fetch alongside the primary ones. */
  additionalContextFields?: Array<{
    adoFieldRef: string;
    label: string;
    fetchLinks?: boolean;
    fetchImages?: boolean;
  }>;
}

export async function saveConventions(
  payload: ConventionsPayload,
  workspaceRoot: string,
): Promise<{ workspaceConfigPath: string }> {
  const safety = isWorkspaceSafeForWrite(workspaceRoot);
  if (!safety.ok) {
    throw new Error(`Cannot save conventions: ${safety.reason}`);
  }

  const wsDir = workspaceDir(workspaceRoot);
  const wsFile = workspaceConfigFile(workspaceRoot);
  if (!existsSync(wsDir)) {
    mkdirSync(wsDir, { recursive: true });
  }

  // Existing config must already exist with an `ado` block — Tab 2 is gated
  // on Tab 1 having succeeded, so this is a guarantee. Defensive parse.
  if (!existsSync(wsFile)) {
    throw new Error(
      "Cannot save conventions: no workspace config exists yet. Save your connection first (Tab 1).",
    );
  }
  let existingConfig: WorkspaceConfig;
  try {
    existingConfig = WorkspaceConfigSchema.parse(JSON.parse(readFileSync(wsFile, "utf-8")));
  } catch (err) {
    throw new Error(
      `Cannot save conventions: existing workspace config is malformed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!existingConfig.ado?.org || !existingConfig.ado?.project) {
    throw new Error(
      "Cannot save conventions: workspace config has no ADO connection. Save your connection first (Tab 1).",
    );
  }

  // Merge payload into the existing config. We touch only convention blocks;
  // ado + confluence are preserved verbatim.
  const merged: WorkspaceConfig = {
    ...existingConfig,
    version: 1,
    // suiteStructure block — overlay sprintPrefix and/or testPlanMapping if
    // supplied. Other suiteStructure fields (parentUsSeparator, etc.) come
    // from framework defaults at load time, so we don't need to write them.
    ...(payload.sprintPrefix !== undefined || payload.testPlanMapping !== undefined
      ? {
          suiteStructure: {
            ...(existingConfig.suiteStructure ?? {}),
            ...(payload.sprintPrefix !== undefined ? { sprintPrefix: payload.sprintPrefix } : {}),
            ...(payload.testPlanMapping !== undefined
              ? { testPlanMapping: payload.testPlanMapping }
              : {}),
          },
        }
      : {}),

    // prerequisiteDefaults — only the personas slice is in scope for the
    // wizard; personaRolesLabel / personaPsgLabel stay framework-default.
    ...(payload.personas !== undefined
      ? {
          prerequisiteDefaults: {
            ...(existingConfig.prerequisiteDefaults ?? {}),
            personas: payload.personas,
          },
        }
      : {}),

    // ado.fieldRefs — preserve the existing ado block, overlay fieldRefs.
    ...(payload.prerequisiteFieldRef !== undefined ||
    payload.solutionDesignFieldRef !== undefined
      ? {
          ado: {
            ...existingConfig.ado,
            fieldRefs: {
              ...(existingConfig.ado.fieldRefs ?? {}),
              ...(payload.prerequisiteFieldRef !== undefined
                ? { prerequisite: payload.prerequisiteFieldRef }
                : {}),
              ...(payload.solutionDesignFieldRef !== undefined
                ? { solutionDesign: payload.solutionDesignFieldRef }
                : {}),
            },
          },
        }
      : {}),

    // additionalContextFields — replace wholesale (empty array clears).
    ...(payload.additionalContextFields !== undefined
      ? { additionalContextFields: payload.additionalContextFields }
      : {}),
  };

  writeFileSync(wsFile, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return { workspaceConfigPath: wsFile };
}

function getHtmlContent(
  existingCreds: Partial<Credentials> & { _patStored?: boolean; _confluenceTokenStored?: boolean },
): string {
  const currentYear = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vortex ADO - Configure</title>
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
      max-width: 620px;
      margin: 0 auto;
      padding: 1.25rem 1.5rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    /* Header */
    .header {
      text-align: center;
      margin-bottom: 1.25rem;
      animation: fadeInDown 0.8s ease;
    }

    @keyframes fadeInDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .logo-container {
      position: relative;
      display: inline-block;
      margin-bottom: 1rem;
    }

    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 50%, var(--accent) 100%);
      border-radius: 20px;
      position: relative;
      box-shadow: 
        0 0 40px var(--primary-glow),
        0 15px 30px rgba(0, 0, 0, 0.3),
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
      width: 36px;
      height: 36px;
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
      font-size: 1.875rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--text-bright) 0%, var(--primary-light) 50%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
      letter-spacing: -0.02em;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
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
      border-radius: 16px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 0.875rem;
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
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .card-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      box-shadow: 0 6px 16px var(--primary-glow);
      flex-shrink: 0;
    }

    .card-icon::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 50%);
      border-radius: 14px;
    }

    .card-icon svg {
      width: 20px;
      height: 20px;
      color: white;
    }

    .card-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text-bright);
    }

    .card-badge {
      margin-left: auto;
      padding: 0.25rem 0.75rem;
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
      margin-bottom: 0.875rem;
    }

    label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.375rem;
      transition: color 0.2s ease;
    }

    .form-group:focus-within label {
      color: var(--primary-light);
    }

    input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 10px;
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
      padding: 0.625rem 1.25rem;
      border-radius: 10px;
      font-size: 0.875rem;
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
      margin-top: 0.875rem;
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
      margin-top: 1.25rem;
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
      min-width: 220px;
      padding: 0.875rem 2rem;
      font-size: 0.95rem;
      border-radius: 12px;
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

    /* Copyright footer - sticky at bottom */
    .copyright {
      text-align: center;
      padding: 1rem 0 0.75rem;
      color: var(--text-dim);
      font-size: 0.75rem;
      animation: fadeIn 0.6s ease 0.5s forwards;
      opacity: 0;
      margin-top: auto;
      flex-shrink: 0;
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

    /* ─────────── Phase 2 additions: tabs, modal, tooltips ─────────── */
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
    }
    .tab {
      flex: 1;
      padding: 0.85rem 1rem;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 200ms ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      position: relative;
    }
    .tab:hover:not(:disabled) {
      color: var(--text);
    }
    .tab.active {
      color: var(--primary-light);
      border-bottom-color: var(--primary);
    }
    .tab:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .tab .tab-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--bg-input);
      border: 1px solid var(--border);
      font-size: 0.8rem;
      font-weight: 700;
    }
    .tab.active .tab-num {
      background: var(--primary);
      color: var(--text-bright);
      border-color: var(--primary);
    }
    .tab[data-locked]::after {
      content: '🔒';
      margin-left: 0.4rem;
      font-size: 0.85rem;
    }
    .tab-panel {
      display: none;
    }
    .tab-panel.active {
      display: block;
    }

    /* Info tooltip — small ⓘ that reveals helper text on hover/focus */
    .info-tip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(139, 92, 246, 0.15);
      color: var(--primary-light);
      font-size: 0.72rem;
      font-weight: 700;
      margin-left: 0.4rem;
      cursor: help;
      position: relative;
      vertical-align: middle;
      user-select: none;
    }
    /* The info bubble uses position:fixed to escape any ancestor with
       overflow:hidden (the .card is one). JS positions the bubble next to
       the icon on hover/focus — see positionInfoBubble() in the script. */
    .info-tip {
      position: relative;
    }
    .info-bubble {
      position: fixed;
      left: 0;
      top: 0;
      width: 320px;
      max-width: calc(100vw - 32px);
      padding: 0.7rem 0.9rem;
      background: rgba(20, 25, 40, 0.98);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.82rem;
      font-weight: 400;
      line-height: 1.45;
      text-align: left;
      opacity: 0;
      transition: opacity 180ms ease;
      pointer-events: none;
      z-index: 200;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      white-space: normal;
      visibility: hidden;
    }
    .info-bubble.show {
      opacity: 1;
      visibility: visible;
    }

    /* Read-only display field */
    .readonly-display {
      padding: 0.85rem 1rem;
      background: rgba(139, 92, 246, 0.06);
      border: 1px dashed var(--border);
      border-radius: 8px;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
      font-size: 0.9rem;
      user-select: text;
    }
    .readonly-display .field-note {
      display: block;
      margin-top: 0.4rem;
      font-family: 'Inter', sans-serif;
      font-size: 0.78rem;
      color: var(--text-dim);
      font-style: italic;
    }

    /* Plan-mapping list rows */
    .plan-row, .persona-row, .ctxfield-row {
      display: grid;
      gap: 0.5rem;
      padding: 0.65rem 0.85rem;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 0.5rem;
      align-items: center;
    }
    .plan-row {
      grid-template-columns: 28px 1fr 1.2fr;
    }
    /* Persona row uses a 2-row grid so each labeled field gets enough width.
       Row 1: Label, Profile, Roles, PSG (all visible). Row 2: Key + remove.
       This avoids the truncated-input problem on standard widths. */
    .persona-row {
      grid-template-columns: 1fr 1fr 1fr 1fr;
      grid-template-areas:
        "label profile roles psg"
        "key key key remove";
      row-gap: 0.45rem;
    }
    .persona-row > [data-field="label"]   { grid-area: label; }
    .persona-row > [data-field="profile"] { grid-area: profile; }
    .persona-row > [data-field="roles"]   { grid-area: roles; }
    .persona-row > [data-field="psg"]     { grid-area: psg; }
    .persona-row > [data-field="key"]     { grid-area: key; }
    .persona-row > .row-remove            { grid-area: remove; justify-self: end; }
    .ctxfield-row {
      grid-template-columns: 28px 1.6fr 1fr;
    }
    .plan-row input[type="text"], .persona-row input[type="text"], .ctxfield-row input[type="text"], .ctxfield-row select {
      padding: 0.55rem 0.7rem;
      background: var(--bg-darker);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-family: inherit;
      font-size: 0.88rem;
      width: 100%;
    }
    .persona-row input[type="text"]::placeholder {
      color: var(--text-dim);
      opacity: 0.7;
    }
    /* On narrow screens, stack persona fields vertically. */
    @media (max-width: 720px) {
      .persona-row {
        grid-template-columns: 1fr;
        grid-template-areas:
          "label"
          "profile"
          "roles"
          "psg"
          "key"
          "remove";
      }
    }
    .plan-row .plan-meta {
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .plan-row .plan-meta b { color: var(--text); font-weight: 600; }
    .row-remove {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      cursor: pointer;
      transition: all 150ms ease;
      font-size: 1rem;
      line-height: 1;
    }
    .row-remove:hover {
      background: rgba(244, 63, 94, 0.15);
      border-color: var(--error);
      color: var(--error);
    }
    .row-add-btn {
      margin-top: 0.5rem;
      padding: 0.55rem 0.95rem;
      background: rgba(139, 92, 246, 0.1);
      border: 1px dashed var(--primary);
      border-radius: 8px;
      color: var(--primary-light);
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 150ms ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .row-add-btn:hover {
      background: rgba(139, 92, 246, 0.18);
    }

    /* Compact heading style for sub-sections inside Tab 2 */
    .subsection-title {
      display: flex;
      align-items: center;
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 0.65rem;
      margin-top: 1.5rem;
      letter-spacing: 0.02em;
    }
    .subsection-title:first-child { margin-top: 0; }

    /* Banner shown when org/project changed on Tab 1 save */
    .info-banner, .warn-banner {
      padding: 0.85rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .info-banner {
      background: rgba(6, 182, 212, 0.08);
      border: 1px solid rgba(6, 182, 212, 0.3);
      color: var(--text);
    }
    .warn-banner {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: var(--text);
    }

    /* Confirmation modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .modal-overlay.show { display: flex; }
    .modal {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.75rem;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    .modal h3 {
      margin: 0 0 0.85rem;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text-bright);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .modal p { color: var(--text); margin: 0 0 1rem; line-height: 1.55; }
    .modal pre.modal-detail {
      background: var(--bg-darker);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.82rem;
      color: var(--text-muted);
      overflow-x: auto;
      margin: 0 0 1rem;
      max-height: 200px;
    }
    .modal-actions {
      display: flex;
      gap: 0.65rem;
      justify-content: flex-end;
      margin-top: 1.25rem;
    }
    .modal-actions .btn { flex: 0 0 auto; padding: 0.65rem 1.25rem; }

    /* Status pill rendered next to inputs after probe */
    .probe-status {
      font-size: 0.82rem;
      color: var(--text-muted);
      padding: 0.4rem 0;
    }
    .probe-status.ok { color: var(--success); }
    .probe-status.warn { color: var(--warning); }
    .probe-status.err { color: var(--error); }

    /* Status info pill in field labels for "stored" indicator */
    .field-pill {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.12);
      color: var(--success);
      font-size: 0.7rem;
      font-weight: 600;
      margin-left: 0.5rem;
      letter-spacing: 0.02em;
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
    <div class="main-content">
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
        <h1>Vortex ADO</h1>
        <p class="subtitle">Configure your <span>workspace</span></p>
      </div>

      <!-- Tabs -->
      <div class="tabs" role="tablist">
        <button type="button" class="tab active" id="tab-1" role="tab" aria-selected="true" onclick="switchTab(1)">
          <span class="tab-num">1</span> Connection
        </button>
        <button type="button" class="tab" id="tab-2" role="tab" aria-selected="false" onclick="switchTab(2)" data-locked>
          <span class="tab-num">2</span> Conventions
        </button>
      </div>

      <!-- Tab 1: Connection -->
      <div class="tab-panel active" id="panel-1" role="tabpanel">
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
            <label for="ado_pat">
              Personal Access Token (PAT)
              ${existingCreds._patStored ? '<span class="field-pill">stored in keychain</span>' : ''}
              <span class="info-tip" tabindex="0">i<span class="info-bubble">Your ADO PAT is stored in the OS keychain (macOS Keychain / Windows Credential Manager / Linux libsecret) — never on disk. Leave blank when re-running the wizard if you don't want to change it.</span></span>
            </label>
            <input type="password" id="ado_pat" placeholder="${existingCreds._patStored ? '(leave blank to keep saved PAT)' : 'Enter your ADO PAT'}" value="">
          </div>

          <div class="form-group">
            <label for="ado_org">
              Organization
              <span class="info-tip" tabindex="0">i<span class="info-bubble">The organization slug from your ADO URL: https://dev.azure.com/&lt;ORG&gt;.</span></span>
            </label>
            <input type="text" id="ado_org" placeholder="e.g., YourOrgName" value="${existingCreds.ado_org || ""}">
          </div>

          <div class="form-group">
            <label for="ado_project">
              Project
              <span class="info-tip" tabindex="0">i<span class="info-bubble">The project name within the organization. Spaces are allowed.</span></span>
            </label>
            <input type="text" id="ado_project" placeholder="e.g., YourProjectName" value="${existingCreds.ado_project || ""}">
          </div>

          <div id="ado-status"></div>
        </div>

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
                <label for="confluence_api_token">
                  API Token
                  ${existingCreds._confluenceTokenStored ? '<span class="field-pill">stored in keychain</span>' : ''}
                </label>
                <input type="password" id="confluence_api_token" placeholder="${existingCreds._confluenceTokenStored ? '(leave blank to keep saved token)' : 'Enter your Confluence API token'}" value="">
              </div>
              <div id="confluence-status"></div>
            </div>
          </div>
        </div>

        <div class="footer">
          <button type="button" class="btn btn-primary btn-save" id="save-connection-btn" onclick="saveConnection()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Validate and Save Connection
          </button>
        </div>
      </div>

      <!-- Tab 2: Conventions -->
      <div class="tab-panel" id="panel-2" role="tabpanel">
        <div id="tab2-blocked-message" class="info-banner" style="display: none;">
          Save your connection on Tab 1 first to enable convention setup.
        </div>
        <div id="tab2-orgchanged-banner" class="warn-banner" style="display: none;">
          <strong>Project changed.</strong> Plan IDs and custom field references differ between projects. We've reloaded fresh probes for the new project. Choose which existing conventions (if any) to reuse below — or start fresh.
          <div style="margin-top: 0.65rem;">
            <button type="button" class="btn btn-secondary" onclick="reloadConventions(true)" style="margin-right: 0.4rem;">Reuse my existing conventions</button>
            <button type="button" class="btn btn-secondary" onclick="reloadConventions(false)">Start fresh</button>
          </div>
        </div>

        <div class="card" id="tab2-card" style="display: none;">
          <div class="card-header">
            <div class="card-icon" style="background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%); box-shadow: 0 8px 20px rgba(6, 182, 212, 0.4);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>
            <span class="card-title">Project Conventions</span>
            <span class="card-badge badge-optional">Recommended</span>
          </div>

          <!-- Test case title format (read-only display) -->
          <div class="form-group">
            <label>
              Test case title format
              <span class="info-tip" tabindex="0">i<span class="info-bubble">This format is fixed for now to ensure consistent parsing during draft → ADO sync. Custom prefixes are planned for a future release.</span></span>
            </label>
            <div class="readonly-display">
              TC_&lt;userStoryId&gt;_&lt;NN&gt; -&gt; &lt;featureTags&gt; -&gt; &lt;use case&gt;
              <span class="field-note">Read-only · TC = fixed prefix · NN = zero-padded TC number · arrow segments are derived from your draft.</span>
            </div>
          </div>

          <!-- Sprint prefix -->
          <div class="form-group">
            <label for="sprint-prefix-input">
              Sprint folder prefix
              <span class="info-tip" tabindex="0">i<span class="info-bubble">Used to derive a sprint number from your User Story's Iteration path. Example: with prefix "Sprint_" the iteration "Sprint_14" maps to sprint 14. Suite folders are also named using this prefix (e.g. "Sprint_14"). Use whatever convention your team follows.</span></span>
            </label>
            <input type="text" id="sprint-prefix-input" placeholder="Sprint_">
            <div id="sprint-prefix-status" class="probe-status"></div>
          </div>

          <!-- Plan mappings -->
          <div class="form-group">
            <div class="subsection-title">
              Test plan mappings
              <span class="info-tip" tabindex="0">i<span class="info-bubble">When you push a test case, the system uses your User Story's AreaPath to pick which test plan it belongs to. Check each plan you publish to and adjust the AreaPath fragment if the auto-suggestion isn't right. Without at least one mapping, /qa-publish will fail.</span></span>
            </div>
            <div id="plan-mapping-list"></div>
            <div id="plan-mapping-status" class="probe-status"></div>
          </div>

          <!-- Personas -->
          <div class="form-group">
            <div class="subsection-title">
              Personas
              <span class="info-tip" tabindex="0">i<span class="info-bubble">Test users that appear in every test case's Prerequisites section. If left empty, your TCs will have no Persona section. Add the standard test users your team uses for verification.</span></span>
            </div>
            <div id="personas-list"></div>
            <button type="button" class="row-add-btn" onclick="addPersonaRow()">+ Add persona</button>
          </div>

          <!-- Field refs -->
          <div class="form-group">
            <label for="prereq-field-select">
              Prerequisite field reference
              <span class="info-tip" tabindex="0">i<span class="info-bubble">The ADO custom field where Prerequisites HTML is stored on a Test Case. Default System.Description works for most projects; override only if your team has a custom field like Custom.PrerequisiteforTest.</span></span>
            </label>
            <select id="prereq-field-select" class="probe-select">
              <option value="">System.Description (framework default)</option>
            </select>
            <div id="prereq-field-status" class="probe-status"></div>
          </div>

          <div class="form-group">
            <label for="solution-field-select">
              Solution Design field reference (optional)
              <span class="info-tip" tabindex="0">i<span class="info-bubble">If your team links Confluence Solution Design pages from a custom ADO field on User Stories, set this so /ado-story auto-fetches the linked page. Leave blank if you don't use Solution Design.</span></span>
            </label>
            <select id="solution-field-select" class="probe-select">
              <option value="">— not used —</option>
            </select>
          </div>

          <!-- Additional context fields -->
          <div class="form-group">
            <div class="subsection-title">
              Additional context fields
              <span class="info-tip" tabindex="0">i<span class="info-bubble">Extra ADO custom fields that /ado-story should fetch as named context for the agent (e.g. Impact Assessment, Reference Documentation). Optional — leave empty if you only need standard fields.</span></span>
            </div>
            <div id="ctx-fields-list"></div>
            <button type="button" class="row-add-btn" onclick="addContextField()">+ Add context field</button>
          </div>
        </div>

        <div class="footer" id="tab2-footer" style="display: none;">
          <button type="button" class="btn btn-primary btn-save" id="save-conventions-btn" onclick="trySaveConventions()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            Save Conventions
          </button>
        </div>
      </div>
    </div>

    <div class="copyright">
      &copy; ${currentYear} Vortex ADO by <a href="#">Kavita Badgujar</a>. All rights reserved.
    </div>
  </div>

  <!-- Confirmation modal -->
  <div class="modal-overlay" id="modal-overlay">
    <div class="modal">
      <h3 id="modal-title">Confirm</h3>
      <p id="modal-body"></p>
      <pre class="modal-detail" id="modal-detail" style="display: none;"></pre>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal(false)">Cancel</button>
        <button type="button" class="btn btn-primary" id="modal-confirm-btn" onclick="closeModal(true)">Confirm</button>
      </div>
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
      <h2 class="success-title" id="success-title">Saved!</h2>
      <p class="success-message" id="success-message">Restart Cursor IDE to apply changes</p>
      <button type="button" class="btn btn-success" onclick="closeAndShutdown()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
        Close Window
      </button>
    </div>
  </div>

  <script>
    // ─────────── Particles (decorative) ───────────
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

    // ─────────── State ───────────
    const existing = ${JSON.stringify({
      _patStored: existingCreds._patStored ?? false,
      _confluenceTokenStored: existingCreds._confluenceTokenStored ?? false,
      ado_org: existingCreds.ado_org ?? "",
      ado_project: existingCreds.ado_project ?? "",
    })};
    // After Tab 1 saves, flips to true so Tab 2 enables.
    let connectionSaved = existing._patStored;
    // Snapshot of the conventions form state at last load — used for diff-based modal trigger.
    let conventionsSnapshot = null;
    // Stash of probe data used to render Tab 2 form.
    let probedPlans = [];
    let probedFields = { prerequisiteCandidates: [], solutionDesignCandidates: [], contextCandidates: [] };
    // PAT we use for probes — the just-typed value if Tab 1 just saved, otherwise we re-fetch via check-keychain-pat.
    let activePat = null;

    // ─────────── Status helpers ───────────
    function showStatus(elementId, type, message, details) {
      const container = document.getElementById(elementId);
      if (!container) return;
      let icon = '';
      if (type === 'success') {
        icon = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      } else if (type === 'error') {
        icon = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      } else if (type === 'loading') {
        icon = '<svg class="status-icon spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
      }
      container.innerHTML = \`<div class="status status-\${type}">\${icon}<div><div>\${message}</div>\${details ? '<div class="status-details">' + details + '</div>' : ''}</div></div>\`;
    }

    function toggleConfluence() {
      const content = document.getElementById('confluence-content');
      const header = document.querySelector('.collapsible-header');
      content.classList.toggle('open');
      header.classList.toggle('open');
    }

    // ─────────── Tab switching + gating ───────────
    function switchTab(n) {
      if (n === 2 && !connectionSaved) {
        // Trying to enter Tab 2 without a saved connection — refuse.
        showStatus('ado-status', 'error', 'Connection required', 'Save your connection on Tab 1 first.');
        return;
      }
      document.getElementById('tab-1').classList.toggle('active', n === 1);
      document.getElementById('tab-2').classList.toggle('active', n === 2);
      document.getElementById('tab-1').setAttribute('aria-selected', n === 1 ? 'true' : 'false');
      document.getElementById('tab-2').setAttribute('aria-selected', n === 2 ? 'true' : 'false');
      document.getElementById('panel-1').classList.toggle('active', n === 1);
      document.getElementById('panel-2').classList.toggle('active', n === 2);

      if (n === 2) {
        activateConventionsTab();
      }
    }

    function setTab2Locked(locked) {
      const tab2 = document.getElementById('tab-2');
      tab2.disabled = locked;
      if (locked) tab2.setAttribute('data-locked', '');
      else tab2.removeAttribute('data-locked');
    }
    setTab2Locked(!connectionSaved);

    // ─────────── Tab 2: silent revalidation + probe + load ───────────
    let tab2Activated = false;
    async function activateConventionsTab(forceReload = false) {
      const card = document.getElementById('tab2-card');
      const footer = document.getElementById('tab2-footer');
      const blocked = document.getElementById('tab2-blocked-message');

      if (!connectionSaved) {
        blocked.style.display = 'block';
        card.style.display = 'none';
        footer.style.display = 'none';
        return;
      }
      blocked.style.display = 'none';
      if (tab2Activated && !forceReload) return; // load once

      // 1. Silently revalidate the keychain PAT (returning user) OR use the
      //    just-typed PAT (first-time user who just saved Tab 1).
      if (!activePat) {
        const check = await fetch('/api/check-keychain-pat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r => r.json());
        if (!check.ok) {
          showStatus('ado-status', 'error', 'PAT validation failed', check.message || 'Update your PAT on Tab 1.');
          card.style.display = 'none';
          footer.style.display = 'none';
          return;
        }
        activePat = check.pat;
      }

      // 2. Run probes in parallel.
      const org = document.getElementById('ado_org').value.trim();
      const project = document.getElementById('ado_project').value.trim();
      const probeBody = JSON.stringify({ pat: activePat, org, project });

      const [plans, fields, iterations, existing] = await Promise.all([
        fetch('/api/probe-plans', { method: 'POST', headers: {'Content-Type':'application/json'}, body: probeBody }).then(r => r.json()).catch(() => ({ ok: false })),
        fetch('/api/probe-fields', { method: 'POST', headers: {'Content-Type':'application/json'}, body: probeBody }).then(r => r.json()).catch(() => ({ ok: false })),
        fetch('/api/probe-iterations', { method: 'POST', headers: {'Content-Type':'application/json'}, body: probeBody }).then(r => r.json()).catch(() => ({ ok: false })),
        fetch('/api/load-existing').then(r => r.json()).catch(() => ({ success: false })),
      ]);

      probedPlans = plans.ok ? (plans.data || []) : [];
      probedFields = fields.ok ? fields.data : { prerequisiteCandidates: [], solutionDesignCandidates: [], contextCandidates: [] };

      // Plans status
      if (plans.ok) {
        document.getElementById('plan-mapping-status').textContent =
          probedPlans.length === 0 ? 'No test plans found in this project.' : '';
        document.getElementById('plan-mapping-status').className = 'probe-status' + (probedPlans.length === 0 ? ' warn' : '');
      } else {
        document.getElementById('plan-mapping-status').textContent = 'Could not fetch plans: ' + (plans.message || 'unknown error') + ' — you can still hand-type plan IDs.';
        document.getElementById('plan-mapping-status').className = 'probe-status err';
      }

      // 3. Render the form using existing config (if any) + probed data.
      const existingConventions = (existing && existing.success) ? (existing.existingConventions || {}) : {};
      renderConventionsForm(existingConventions);

      // 4. Prepopulate sprint prefix from probe iff the existing config
      //    didn't supply one. This ensures workspace config wins, with the
      //    probed value as a fallback. Always show the "detected" hint.
      if (iterations.ok && iterations.data && iterations.data.suggestedPrefix) {
        const input = document.getElementById('sprint-prefix-input');
        const status = document.getElementById('sprint-prefix-status');
        if (!input.value.trim()) {
          input.value = iterations.data.suggestedPrefix;
        }
        status.textContent = 'Detected from your iterations: ' + iterations.data.suggestedPrefix + ' — edit if your team uses a different prefix.';
        status.className = 'probe-status ok';
      }

      conventionsSnapshot = serializeConventionsForm();

      card.style.display = 'block';
      footer.style.display = 'flex';
      tab2Activated = true;
    }

    function renderConventionsForm(existingConventions) {
      // Sprint prefix
      document.getElementById('sprint-prefix-input').value = existingConventions.sprintPrefix || '';

      // Plan mapping list — render every probed plan with checkbox + fragment input
      const planList = document.getElementById('plan-mapping-list');
      planList.innerHTML = '';
      const existingByPlanId = {};
      (existingConventions.testPlanMapping || []).forEach(m => {
        existingByPlanId[m.planId] = Array.isArray(m.areaPathContains) ? m.areaPathContains.join(', ') : m.areaPathContains;
      });
      if (probedPlans.length === 0) {
        // Probe failed — render at least one manual-entry row so user isn't blocked.
        addManualPlanRow();
      } else {
        probedPlans.forEach(plan => {
          const row = document.createElement('div');
          row.className = 'plan-row';
          row.dataset.planId = plan.planId;
          row.innerHTML = \`
            <input type="checkbox" \${existingByPlanId[plan.planId] !== undefined ? 'checked' : ''} />
            <div class="plan-meta"><b>\${escapeHtml(plan.name)}</b><br>Plan #\${plan.planId} · \${escapeHtml(plan.areaPath || '(no areaPath)')}</div>
            <input type="text" placeholder="AreaPath fragment(s), comma-separated" value="\${escapeHtml(existingByPlanId[plan.planId] !== undefined ? existingByPlanId[plan.planId] : plan.suggestedFragment)}" />
          \`;
          planList.appendChild(row);
        });
      }

      // Personas
      const personasList = document.getElementById('personas-list');
      personasList.innerHTML = '';
      const existingPersonas = existingConventions.personas || {};
      const personaKeys = Object.keys(existingPersonas);
      if (personaKeys.length === 0) {
        // Empty by default — user adds rows.
      } else {
        personaKeys.forEach(key => {
          const p = existingPersonas[key];
          addPersonaRow(key, p);
        });
      }

      // Prereq field select
      const prereqSelect = document.getElementById('prereq-field-select');
      prereqSelect.innerHTML = '<option value="">System.Description (framework default)</option>';
      probedFields.prerequisiteCandidates.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.referenceName;
        opt.textContent = \`\${f.name} (\${f.referenceName})\`;
        prereqSelect.appendChild(opt);
      });
      if (existingConventions.prerequisiteFieldRef) prereqSelect.value = existingConventions.prerequisiteFieldRef;

      // Solution design field select
      const solSelect = document.getElementById('solution-field-select');
      solSelect.innerHTML = '<option value="">— not used —</option>';
      probedFields.solutionDesignCandidates.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.referenceName;
        opt.textContent = \`\${f.name} (\${f.referenceName})\`;
        solSelect.appendChild(opt);
      });
      if (existingConventions.solutionDesignFieldRef) solSelect.value = existingConventions.solutionDesignFieldRef;

      // Additional context fields
      const ctxList = document.getElementById('ctx-fields-list');
      ctxList.innerHTML = '';
      (existingConventions.additionalContextFields || []).forEach(f => addContextField(f));
    }

    function addManualPlanRow() {
      const list = document.getElementById('plan-mapping-list');
      const row = document.createElement('div');
      row.className = 'plan-row';
      row.dataset.planId = '';
      row.dataset.manual = 'true';
      row.innerHTML = \`
        <input type="checkbox" checked />
        <div><input type="number" placeholder="Plan ID" style="width: 100%; padding: 0.45rem 0.65rem; background: var(--bg-darker); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: inherit; font-size: 0.85rem;" /></div>
        <input type="text" placeholder="AreaPath fragment(s), comma-separated" />
      \`;
      list.appendChild(row);
    }

    function addPersonaRow(key, persona) {
      const list = document.getElementById('personas-list');
      const row = document.createElement('div');
      row.className = 'persona-row';
      const k = key || '';
      const p = persona || { label: '', profile: '', user: '', roles: '', psg: '' };
      // Persona "key" is the internal JSON key for the persona (e.g. "Admin"
      // for the persona labeled "Administrator"). Auto-derived from the
      // label if the user doesn't provide one. Stripped to alphanumeric +
      // underscore so it works as a JSON key.
      row.innerHTML = \`
        <input type="text" placeholder="Display label (e.g. Standard User)" value="\${escapeHtml(p.label || '')}" data-field="label" />
        <input type="text" placeholder="Profile name" value="\${escapeHtml(p.profile || '')}" data-field="profile" />
        <input type="text" placeholder="Role(s)" value="\${escapeHtml(p.roles || '')}" data-field="roles" />
        <input type="text" placeholder="Permission Set Group" value="\${escapeHtml(p.psg || '')}" data-field="psg" />
        <input type="text" placeholder="Internal key (auto-generated from label if blank)" value="\${escapeHtml(k)}" data-field="key" />
        <button type="button" class="row-remove" onclick="this.parentElement.remove()" title="Remove persona">×</button>
      \`;
      list.appendChild(row);
    }

    /**
     * Derive a clean JSON key from a persona's display label.
     * "Key Account Manager (KAM) User" → "KeyAccountManagerKAMUser"
     * Strips spaces, punctuation, keeps alphanumerics. Fallback "Persona1".
     */
    function derivePersonaKey(label, fallbackIndex) {
      const cleaned = String(label || '').replace(/[^A-Za-z0-9]/g, '');
      return cleaned || ('Persona' + (fallbackIndex + 1));
    }

    function addContextField(existing) {
      const list = document.getElementById('ctx-fields-list');
      const row = document.createElement('div');
      row.className = 'ctxfield-row';
      const e = existing || { adoFieldRef: '', label: '' };
      row.innerHTML = \`
        <button type="button" class="row-remove" onclick="this.parentElement.remove(); refreshContextFieldDropdowns();" title="Remove">×</button>
        <select data-field="adoFieldRef" data-current="\${escapeHtml(e.adoFieldRef || '')}" onchange="refreshContextFieldDropdowns()">
          <option value="">— pick a field —</option>
        </select>
        <input type="text" placeholder="Display label" value="\${escapeHtml(e.label || '')}" data-field="label" />
      \`;
      list.appendChild(row);
      // Pre-fill the data-current attribute reflects what was originally
      // selected; refreshContextFieldDropdowns will populate the option list.
      refreshContextFieldDropdowns();
      // Set the current selection AFTER options are populated.
      const sel = row.querySelector('select[data-field="adoFieldRef"]');
      if (e.adoFieldRef) sel.value = e.adoFieldRef;
    }

    /**
     * Repopulate every additional-context-field dropdown so options already
     * picked by another row are HIDDEN (preventing duplicates). Each row's
     * own current selection always remains in its dropdown.
     */
    function refreshContextFieldDropdowns() {
      const rows = Array.from(document.querySelectorAll('#ctx-fields-list .ctxfield-row'));
      const allSelected = rows.map(r => {
        const sel = r.querySelector('select[data-field="adoFieldRef"]');
        return sel ? sel.value : '';
      }).filter(Boolean);

      rows.forEach(row => {
        const sel = row.querySelector('select[data-field="adoFieldRef"]');
        if (!sel) return;
        const ownValue = sel.value;
        // Build options: empty + all candidates EXCEPT ones picked elsewhere.
        const optsHtml = ['<option value="">— pick a field —</option>'];
        probedFields.contextCandidates.forEach(f => {
          const isOwn = f.referenceName === ownValue;
          const pickedElsewhere = allSelected.includes(f.referenceName) && !isOwn;
          if (pickedElsewhere) return;
          optsHtml.push(\`<option value="\${escapeHtml(f.referenceName)}" \${isOwn ? 'selected' : ''}>\${escapeHtml(f.name)} (\${escapeHtml(f.referenceName)})</option>\`);
        });
        sel.innerHTML = optsHtml.join('');
        // Restore selection
        if (ownValue) sel.value = ownValue;
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function serializeConventionsForm() {
      // Plan mappings
      const testPlanMapping = [];
      document.querySelectorAll('#plan-mapping-list .plan-row').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox || !checkbox.checked) return;
        let planId;
        if (row.dataset.manual === 'true') {
          const numInput = row.querySelector('input[type="number"]');
          planId = parseInt(numInput.value, 10);
          if (isNaN(planId) || planId <= 0) return;
        } else {
          planId = parseInt(row.dataset.planId, 10);
        }
        const fragInput = row.querySelector('input[type="text"]');
        const frag = (fragInput.value || '').trim();
        if (!frag) return;
        testPlanMapping.push({
          planId,
          areaPathContains: frag.split(',').map(s => s.trim()).filter(Boolean),
        });
      });

      // Personas — auto-derive key from label when user leaves it blank.
      const personas = {};
      Array.from(document.querySelectorAll('#personas-list .persona-row')).forEach((row, idx) => {
        const get = (f) => (row.querySelector(\`input[data-field="\${f}"]\`) || {}).value || '';
        const label = get('label').trim();
        if (!label) return; // skip empty rows
        let key = get('key').trim();
        if (!key) key = derivePersonaKey(label, idx);
        // Defensive: avoid overwriting if two rows derive to the same key.
        let unique = key;
        let suffix = 2;
        while (personas[unique]) {
          unique = key + suffix;
          suffix += 1;
        }
        personas[unique] = {
          label,
          profile: get('profile').trim(),
          roles: get('roles').trim(),
          psg: get('psg').trim(),
        };
      });

      // Context fields
      const additionalContextFields = [];
      document.querySelectorAll('#ctx-fields-list .ctxfield-row').forEach(row => {
        const ref = (row.querySelector('select[data-field="adoFieldRef"]') || {}).value || '';
        const label = (row.querySelector('input[data-field="label"]') || {}).value || '';
        if (!ref) return;
        additionalContextFields.push({
          adoFieldRef: ref,
          label: (label || '').trim(),
          fetchLinks: true,
          fetchImages: true,
        });
      });

      return {
        sprintPrefix: document.getElementById('sprint-prefix-input').value.trim(),
        testPlanMapping,
        personas,
        prerequisiteFieldRef: document.getElementById('prereq-field-select').value || undefined,
        solutionDesignFieldRef: document.getElementById('solution-field-select').value || undefined,
        additionalContextFields,
      };
    }

    function isConventionsChanged() {
      if (!conventionsSnapshot) return true;
      return JSON.stringify(canonicalize(serializeConventionsForm())) !== JSON.stringify(canonicalize(conventionsSnapshot));
    }

    // Stable canonicalization for diff comparison — sort keys, strip empty strings/arrays/objects.
    function canonicalize(v) {
      if (Array.isArray(v)) return v.map(canonicalize).filter(x => x !== undefined);
      if (v && typeof v === 'object') {
        const out = {};
        Object.keys(v).sort().forEach(k => {
          const val = canonicalize(v[k]);
          if (val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0) && !(typeof val === 'object' && val !== null && Object.keys(val).length === 0)) {
            out[k] = val;
          }
        });
        return out;
      }
      if (typeof v === 'string') return v.trim();
      return v;
    }

    // ─────────── Modal ───────────
    let modalResolve = null;
    function openModal(title, body, detail) {
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').textContent = body;
      const detailEl = document.getElementById('modal-detail');
      if (detail) {
        detailEl.style.display = 'block';
        detailEl.textContent = detail;
      } else {
        detailEl.style.display = 'none';
      }
      document.getElementById('modal-overlay').classList.add('show');
      return new Promise(resolve => { modalResolve = resolve; });
    }
    function closeModal(confirmed) {
      document.getElementById('modal-overlay').classList.remove('show');
      if (modalResolve) modalResolve(confirmed);
      modalResolve = null;
    }

    // ─────────── Tab 1: Validate and Save Connection ───────────
    async function saveConnection() {
      const patInput = document.getElementById('ado_pat').value.trim();
      const org = document.getElementById('ado_org').value.trim();
      const project = document.getElementById('ado_project').value.trim();

      if (!org || !project) {
        showStatus('ado-status', 'error', 'Missing fields', 'Organization and Project are required.');
        return;
      }
      if (!patInput && !existing._patStored) {
        showStatus('ado-status', 'error', 'PAT required', 'Enter your ADO Personal Access Token.');
        return;
      }

      const btn = document.getElementById('save-connection-btn');
      const originalLabel = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Validating...';
      showStatus('ado-status', 'loading', 'Validating connection against ADO...');

      // If user left PAT blank but a stored one exists, validate the stored PAT
      // by calling check-keychain-pat (cheaper than re-typing).
      let patToUse = patInput;
      if (!patToUse && existing._patStored) {
        // We don't have the PAT in the browser — let the server validate via keychain.
        const check = await fetch('/api/check-keychain-pat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r => r.json()).catch(() => ({ ok: false, message: 'Network error' }));
        if (!check.ok) {
          showStatus('ado-status', 'error', 'Saved PAT no longer valid', (check.message || 'Update your PAT.') + ' Type a new PAT and try again.');
          btn.disabled = false; btn.innerHTML = originalLabel;
          return;
        }
        patToUse = check.pat;
        // No re-validation needed — check-keychain-pat already validated. Skip to save.
      } else {
        // Validate the typed PAT against ADO.
        const test = await fetch('/api/test-ado', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pat: patToUse, org, project }) }).then(r => r.json()).catch(() => ({ success: false, message: 'Network error' }));
        if (!test.success) {
          showStatus('ado-status', 'error', test.message || 'Validation failed', test.details);
          btn.disabled = false; btn.innerHTML = originalLabel;
          return;
        }
      }

      // Validation passed — save.
      const baseUrl = document.getElementById('confluence_base_url').value.trim();
      const email = document.getElementById('confluence_email').value.trim();
      const apiToken = document.getElementById('confluence_api_token').value.trim();
      const credentials = {
        ado_pat: patToUse,
        ado_org: org,
        ado_project: project,
        confluence_base_url: baseUrl,
        confluence_email: email,
        confluence_api_token: apiToken,
      };

      const save = await fetch('/api/save-connection', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(credentials) }).then(r => r.json()).catch(() => ({ success: false, message: 'Network error' }));
      if (!save.success) {
        showStatus('ado-status', 'error', 'Save failed', save.message);
        btn.disabled = false; btn.innerHTML = originalLabel;
        return;
      }

      // Success — unlock Tab 2 and navigate.
      showStatus('ado-status', 'success', 'Connection saved!', save.message);
      connectionSaved = true;
      activePat = patToUse;
      setTab2Locked(false);
      tab2Activated = false; // force fresh load on next entry

      // Show org/project-changed banner if it applies, then auto-switch to Tab 2.
      const banner = document.getElementById('tab2-orgchanged-banner');
      if (save.orgProjectChanged) {
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }
      btn.disabled = false; btn.innerHTML = originalLabel;
      setTimeout(() => switchTab(2), 600);
    }

    // ─────────── Tab 2 banner: reuse vs fresh ───────────
    async function reloadConventions(reuse) {
      document.getElementById('tab2-orgchanged-banner').style.display = 'none';
      tab2Activated = false;
      if (reuse) {
        // Reuse existing — let activate fetch /api/load-existing as usual.
        await activateConventionsTab(true);
      } else {
        // Start fresh — clear existing conventions in memory before re-render
        // by passing an empty existing payload. We achieve this by calling the
        // render directly with empty payload after the probes complete.
        const card = document.getElementById('tab2-card');
        card.style.display = 'none';
        // Fetch probes only, skip /api/load-existing.
        const org = document.getElementById('ado_org').value.trim();
        const project = document.getElementById('ado_project').value.trim();
        const probeBody = JSON.stringify({ pat: activePat, org, project });
        const [plans, fields] = await Promise.all([
          fetch('/api/probe-plans', { method: 'POST', headers: {'Content-Type':'application/json'}, body: probeBody }).then(r => r.json()).catch(() => ({ ok: false })),
          fetch('/api/probe-fields', { method: 'POST', headers: {'Content-Type':'application/json'}, body: probeBody }).then(r => r.json()).catch(() => ({ ok: false })),
        ]);
        probedPlans = plans.ok ? (plans.data || []) : [];
        probedFields = fields.ok ? fields.data : { prerequisiteCandidates: [], solutionDesignCandidates: [], contextCandidates: [] };
        renderConventionsForm({}); // empty → fresh start
        conventionsSnapshot = serializeConventionsForm();
        card.style.display = 'block';
        document.getElementById('tab2-footer').style.display = 'flex';
        tab2Activated = true;
      }
    }

    // ─────────── Tab 2: save flow with confirmation ───────────
    async function trySaveConventions() {
      if (!isConventionsChanged()) {
        showStatus('ado-status', 'success', 'No changes to save', 'Your conventions are already up to date.');
        return;
      }
      // Modal
      const ok = await openModal(
        '⚠️ Update Conventions',
        'You\\'re about to update your project conventions. Existing values for any field you changed will be overwritten. Continue?',
        JSON.stringify(canonicalize(serializeConventionsForm()), null, 2),
      );
      if (!ok) return;

      const btn = document.getElementById('save-conventions-btn');
      const originalLabel = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving...';

      const payload = serializeConventionsForm();
      const save = await fetch('/api/save-conventions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(r => r.json()).catch(() => ({ success: false, message: 'Network error' }));
      if (!save.success) {
        btn.disabled = false; btn.innerHTML = originalLabel;
        await openModal('Save failed', save.message || 'Unknown error', null);
        return;
      }

      conventionsSnapshot = serializeConventionsForm();
      btn.disabled = false; btn.innerHTML = originalLabel;
      document.getElementById('success-title').textContent = 'Conventions Saved!';
      document.getElementById('success-message').textContent = 'Restart Cursor IDE (or refresh MCP) to apply the changes.';
      document.getElementById('success-overlay').classList.add('show');
    }

    async function closeAndShutdown() {
      try { await fetch('/api/shutdown', { method: 'POST' }); } catch (e) {}
      window.close();
    }

    // ─────────── Info-tip positioning ───────────
    // Tooltips use position:fixed and are positioned by JS so they escape any
    // ancestor with overflow:hidden (the .card has it) AND so they flip away
    // from the right edge when the icon is near it.
    function positionInfoBubble(tip) {
      const bubble = tip.querySelector('.info-bubble');
      if (!bubble) return;
      const tipRect = tip.getBoundingClientRect();
      const margin = 8;
      // Render to measure
      bubble.classList.add('show');
      const bubbleRect = bubble.getBoundingClientRect();
      // Try center-above first
      let left = tipRect.left + (tipRect.width / 2) - (bubbleRect.width / 2);
      let top = tipRect.top - bubbleRect.height - margin;
      // Clamp horizontal: keep within viewport
      const maxLeft = window.innerWidth - bubbleRect.width - margin;
      if (left < margin) left = margin;
      else if (left > maxLeft) left = maxLeft;
      // If above doesn't fit, flip to below
      if (top < margin) top = tipRect.bottom + margin;
      bubble.style.left = left + 'px';
      bubble.style.top = top + 'px';
    }
    function hideInfoBubble(tip) {
      const bubble = tip.querySelector('.info-bubble');
      if (bubble) bubble.classList.remove('show');
    }
    document.addEventListener('mouseover', (e) => {
      const tip = e.target.closest && e.target.closest('.info-tip');
      if (tip) positionInfoBubble(tip);
    });
    document.addEventListener('mouseout', (e) => {
      const tip = e.target.closest && e.target.closest('.info-tip');
      if (tip && (!e.relatedTarget || !tip.contains(e.relatedTarget))) hideInfoBubble(tip);
    });
    document.addEventListener('focusin', (e) => {
      const tip = e.target.closest && e.target.closest('.info-tip');
      if (tip) positionInfoBubble(tip);
    });
    document.addEventListener('focusout', (e) => {
      const tip = e.target.closest && e.target.closest('.info-tip');
      if (tip) hideInfoBubble(tip);
    });
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

/**
 * Start the wizard's local HTTP server.
 *
 * The `workspaceRoot` is bound in closure so every save operation lands in
 * the same workspace folder, regardless of what process.cwd() is when
 * Cursor's MCP launches. Pass an absolute path that points at the project
 * folder the user is configuring — the agent should source it from the
 * /ado-connect tool's input arg.
 */
export async function startConfigServer(
  workspaceRoot: string,
): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    let serverInstance: ReturnType<typeof createServer>;

    serverInstance = createServer(async (req, res) => {
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
          const existingCreds = await loadExistingCredentials(workspaceRoot);
          sendHtml(res, getHtmlContent(existingCreds));
        } else if (url === "/api/test-ado" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await testAdoConnection(body.pat, body.org, body.project);
          sendJson(res, result);
        } else if (url === "/api/test-confluence" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await testConfluenceConnection(body.baseUrl, body.email, body.apiToken);
          sendJson(res, result);
        } else if (url === "/api/load-existing" && method === "GET") {
          // Phase 2 — Tab 2 calls this on activation to get existing
          // conventions for prefill + the keychain PAT-validity status.
          try {
            const wsFile = workspaceConfigFile(workspaceRoot);
            let existingConventions: Record<string, unknown> = {};
            if (existsSync(wsFile)) {
              const cfg = WorkspaceConfigSchema.parse(
                JSON.parse(readFileSync(wsFile, "utf-8")),
              );
              existingConventions = {
                sprintPrefix: cfg.suiteStructure?.sprintPrefix,
                testPlanMapping: cfg.suiteStructure?.testPlanMapping,
                personas: cfg.prerequisiteDefaults?.personas,
                prerequisiteFieldRef: cfg.ado?.fieldRefs?.prerequisite,
                solutionDesignFieldRef: cfg.ado?.fieldRefs?.solutionDesign,
                additionalContextFields: cfg.additionalContextFields,
              };
            }
            sendJson(res, { success: true, existingConventions });
          } catch (err) {
            sendJson(
              res,
              { success: false, message: err instanceof Error ? err.message : String(err) },
              400,
            );
          }
        } else if (url === "/api/check-keychain-pat" && method === "POST") {
          // Tab 2 silent revalidation — confirms keychain PAT is still valid.
          const result = await checkKeychainPat(workspaceRoot);
          sendJson(res, result);
        } else if (url === "/api/probe-plans" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await probeAdoPlans(body.pat, body.org, body.project);
          sendJson(res, result);
        } else if (url === "/api/probe-fields" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await probeAdoFields(body.pat, body.org, body.project);
          sendJson(res, result);
        } else if (url === "/api/probe-iterations" && method === "POST") {
          const body = JSON.parse(await parseBody(req));
          const result = await probeIterationPrefix(body.pat, body.org, body.project);
          sendJson(res, result);
        } else if (
          (url === "/api/save-connection" || url === "/api/save") &&
          method === "POST"
        ) {
          // Tab 1: validate-and-save-connection. The legacy /api/save alias is
          // kept so a stale frontend during local deploys doesn't break.
          const body = JSON.parse(await parseBody(req)) as Credentials;
          try {
            const saved = await saveCredentials(body, workspaceRoot);
            sendJson(res, {
              success: true,
              message: `Credentials saved to ${saved.workspaceConfigPath} (PAT in OS keychain)`,
              orgProjectChanged: saved.orgProjectChanged,
            });
          } catch (saveErr) {
            sendJson(
              res,
              { success: false, message: saveErr instanceof Error ? saveErr.message : String(saveErr) },
              400,
            );
          }
        } else if (url === "/api/save-conventions" && method === "POST") {
          // Tab 2: save conventions only. Doesn't touch keychain or
          // ado/confluence blocks.
          const body = JSON.parse(await parseBody(req)) as ConventionsPayload;
          try {
            const saved = await saveConventions(body, workspaceRoot);
            sendJson(res, {
              success: true,
              message: `Conventions saved to ${saved.workspaceConfigPath}`,
            });
          } catch (saveErr) {
            sendJson(
              res,
              { success: false, message: saveErr instanceof Error ? saveErr.message : String(saveErr) },
              400,
            );
          }
        } else if (url === "/api/shutdown" && method === "POST") {
          sendJson(res, { success: true, message: "Server shutting down" });
          // Close server after response is sent
          setTimeout(() => serverInstance.close(), 100);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      } catch (err) {
        sendJson(res, { success: false, message: String(err) }, 500);
      }
    });

    // Find available port
    serverInstance.listen(0, "127.0.0.1", () => {
      const addr = serverInstance.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        resolve({
          port,
          close: () => serverInstance.close(),
        });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    serverInstance.on("error", reject);
  });
}

/**
 * Launch the wizard, returning the URL the browser opens at.
 *
 * The caller MUST pass an absolute path to the workspace folder. /ado-connect
 * is responsible for resolving that path (from the tool's `workspaceRoot` arg
 * and, in a future change, from MCP roots/list). The wizard writes
 * <workspaceRoot>/.vortex-ado/config.json and stores the PAT in the OS
 * keychain.
 */
export async function launchConfigUI(workspaceRoot: string): Promise<string> {
  const { port, close } = await startConfigServer(workspaceRoot);
  const url = `http://127.0.0.1:${port}`;

  openBrowser(url);

  // Auto-close after 10 minutes
  setTimeout(() => {
    close();
  }, 10 * 60 * 1000);

  return url;
}
