import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createCredentialsTemplate,
  getCredentialsPath,
  getTcDraftsDir,
  loadCredentials,
  credentialsFileExists,
  type Credentials,
} from "../credentials.ts";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getCurrentVersion, getLatestChangelogHighlights, isNewerVersion } from "../version.ts";
import { launchConfigUI } from "./configure-ui.ts";

const INITIALIZED_FLAG = ".vortex-ado-initialized";

interface SetupState {
  initialized: boolean;
  lastSeenVersion: string;
  firstRunDate: string;
  lastCheckDate: string;
}

/**
 * Deterministic diagnostic shape returned by `ado_check`.
 *
 * - `overall` is the authoritative verdict — the agent should surface it
 *   verbatim (see DIAGNOSTIC_CONTRACT in src/prompts/shared-contracts.ts).
 * - `rows` are row-level status entries; each maps cleanly to one Markdown
 *   table row. `status` drives the emoji; `detail` is the Value column.
 * - `nextActions` is a deterministic remediation list computed from the
 *   rows — no agent guessing, no inferred causes. An empty array means
 *   everything checks out.
 */
export type SetupOverallStatus = "healthy" | "degraded" | "broken";
export type SetupRowStatus = "pass" | "fail" | "optional-missing";

export interface SetupRow {
  name: string;
  status: SetupRowStatus;
  detail: string;
}

export interface SetupStatus {
  overall: SetupOverallStatus;
  rows: SetupRow[];
  nextActions: string[];
}

/**
 * Inputs to `computeSetupStatus`. Dependency-injected so tests can supply
 * deterministic credentials + existence state without touching
 * `~/.vortex-ado/credentials.json` on disk. Defaults read from the
 * real filesystem — production call sites pass nothing.
 */
export interface SetupStatusDeps {
  creds?: Credentials | null;
  credsPath?: string;
  credentialsFileExists?: boolean;
  tcDraftsPath?: string | null;
}

/**
 * Compute the deterministic setup status. Pure given `deps` — all I/O is
 * behind injectable hooks. Returning a typed object (rather than a prose
 * blob) lets the caller render a consistent table + remediation list and
 * lets tests pin the exact verdict/next-actions for each input shape.
 */
export function computeSetupStatus(deps: SetupStatusDeps = {}): SetupStatus {
  const creds = deps.creds !== undefined ? deps.creds : loadCredentials();
  const credsPath = deps.credsPath ?? getCredentialsPath();
  const rows: SetupRow[] = [];
  const nextActions: string[] = [];

  if (!creds) {
    // Broken state — required credentials missing or invalid.
    const fileExists = deps.credentialsFileExists !== undefined
      ? deps.credentialsFileExists
      : credentialsFileExists();
    if (fileExists) {
      rows.push({
        name: "Credentials file",
        status: "fail",
        detail: `Present at ${credsPath} but contains placeholders or missing required values`,
      });
    } else {
      rows.push({
        name: "Credentials file",
        status: "fail",
        detail: `Not found at ${credsPath}`,
      });
    }
    rows.push({ name: "ADO PAT", status: "fail", detail: "Not configured" });
    rows.push({ name: "ADO Organization", status: "fail", detail: "Not configured" });
    rows.push({ name: "ADO Project", status: "fail", detail: "Not configured" });

    nextActions.push(
      "Run `/vortex-ado/configure` to set the ADO PAT, organization, and project with Test Management read/write scope.",
    );
    if (!fileExists) {
      nextActions.push(
        "Alternative: run `/vortex-ado/ado_connect_save` to create the credentials template, then edit it directly.",
      );
    }

    return { overall: "broken", rows, nextActions };
  }

  // Healthy-or-degraded path — ADO credentials are usable.
  rows.push({ name: "ADO PAT", status: "pass", detail: "Configured" });
  rows.push({ name: "ADO Organization", status: "pass", detail: creds.ado_org });
  rows.push({ name: "ADO Project", status: "pass", detail: creds.ado_project });

  const confluenceConfigured = isConfluenceConfigured(creds);
  if (confluenceConfigured) {
    rows.push({
      name: "Confluence",
      status: "pass",
      detail: `Configured (${creds.confluence_base_url})`,
    });
  } else {
    rows.push({
      name: "Confluence",
      status: "optional-missing",
      detail: "Not configured (optional)",
    });
    nextActions.push(
      "Optional: add `confluence_base_url`, `confluence_email`, and `confluence_api_token` to `~/.vortex-ado/credentials.json` to enable Solution Design fetch.",
    );
  }

  const tcPath = deps.tcDraftsPath !== undefined ? deps.tcDraftsPath : getTcDraftsDir();
  rows.push({
    name: "TC Drafts path",
    status: "pass",
    detail: tcPath ?? "Use workspace (open folder) or set TC_DRAFTS_PATH",
  });

  const overall: SetupOverallStatus = confluenceConfigured ? "healthy" : "degraded";
  return { overall, rows, nextActions };
}

const STATUS_EMOJI: Record<SetupRowStatus, string> = {
  pass: "✓",
  fail: "✗",
  "optional-missing": "–",
};

const OVERALL_LABEL: Record<SetupOverallStatus, string> = {
  healthy: "HEALTHY",
  degraded: "DEGRADED",
  broken: "BROKEN",
};

/**
 * Render a `SetupStatus` as the Markdown block the user sees: Overall
 * line, a `| Check | Status | Detail |` table, and a Next Actions list.
 * DIAGNOSTIC_CONTRACT (src/prompts/shared-contracts.ts) tells the agent
 * to surface this verbatim.
 */
export function formatSetupStatus(status: SetupStatus): string {
  const lines: string[] = [];
  lines.push(`**Overall:** ${OVERALL_LABEL[status.overall]}`);
  lines.push("");
  lines.push("| Check | Status | Detail |");
  lines.push("|---|---|---|");
  for (const row of status.rows) {
    lines.push(`| ${row.name} | ${STATUS_EMOJI[row.status]} | ${row.detail} |`);
  }
  lines.push("");
  lines.push("**Next Actions:**");
  if (status.nextActions.length === 0) {
    lines.push("- None — all checks pass.");
  } else {
    for (const action of status.nextActions) {
      lines.push(`- ${action}`);
    }
  }
  return lines.join("\n");
}

function getStateFilePath(): string {
  return join(dirname(getCredentialsPath()), INITIALIZED_FLAG);
}

function loadSetupState(): SetupState | null {
  const statePath = getStateFilePath();
  if (!existsSync(statePath)) return null;

  try {
    const raw = readFileSync(statePath, "utf-8");
    const data = JSON.parse(raw) as Partial<SetupState>;
    if (!data.initialized || !data.lastSeenVersion || !data.firstRunDate) return null;
    return {
      initialized: true,
      lastSeenVersion: data.lastSeenVersion,
      firstRunDate: data.firstRunDate,
      lastCheckDate: data.lastCheckDate || data.firstRunDate,
    };
  } catch {
    return null;
  }
}

function saveSetupState(version: string, existing?: SetupState | null): void {
  const statePath = getStateFilePath();
  mkdirSync(dirname(statePath), { recursive: true });

  const now = new Date().toISOString();
  const nextState: SetupState = {
    initialized: true,
    lastSeenVersion: version,
    firstRunDate: existing?.firstRunDate || now,
    lastCheckDate: now,
  };

  writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\n", "utf-8");
}

function isValidUrl(value?: string): boolean {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isConfluenceConfigured(creds: Credentials): boolean {
  return Boolean(
    creds.confluence_email &&
    creds.confluence_api_token &&
    isValidUrl(creds.confluence_base_url)
  );
}

function buildFirstRunWelcome(version: string, confluenceConfigured: boolean): string[] {
  const contextLine = confluenceConfigured
    ? "VortexADO MCP connects Cursor IDE directly to Azure DevOps and Confluence — so you can draft, review, and push test cases without ever leaving your editor. It reads your User Stories, automatically pulls in linked Solution Design pages from Confluence for full business and technical context, follows your team's naming conventions, and handles all the ADO plumbing (folder structures, query-based suites, field mappings) so you can stay focused on test quality."
    : "VortexADO MCP connects Cursor IDE directly to Azure DevOps — so you can draft, review, and push test cases without ever leaving your editor. It reads your User Stories, understands your team's naming conventions, and handles all the ADO plumbing (folder structures, query-based suites, field mappings) so you can stay focused on test quality.";
  const getUserStoryLine = confluenceConfigured
    ? "/vortex-ado/ado_story — Fetch a User Story with full QA context + Solution Design"
    : "/vortex-ado/ado_story — Fetch a User Story with full QA context";
  const readinessLine = confluenceConfigured
    ? "Your AI-powered QA co-pilot is ready — with Confluence connected."
    : "Your AI-powered QA co-pilot is ready.";

  return [
    `Welcome to VortexADO MCP v${version}`,
    "",
    readinessLine,
    "",
    contextLine,
    "",
    "Think of it as the QA teammate who never forgets a convention, never skips a step, and works at the speed of your prompts.",
    "",
    "Two ways to work — pick what feels natural:",
    "- Slash command: /vortex-ado/qa-draft",
    '- Plain English: "Draft test cases for User Story #12345"',
    "",
    "Ready? Start here:",
    `- ${getUserStoryLine}`,
    "- /vortex-ado/qa-draft — Generate test cases ready for ADO",
    "- /vortex-ado/check_status — Verify your setup anytime",
    "",
    'Quick start: Try /vortex-ado/ado_story or say "Draft test cases for User Story #12345".',
  ];
}

function buildUpdateMessage(version: string): string[] {
  const highlights = getLatestChangelogHighlights(5);
  const lines = [`What's New in VortexADO MCP v${version}`, ""];

  if (highlights.length > 0) {
    lines.push(...highlights.map((item) => `- ${item}`));
  } else {
    lines.push("- Improvements are available in this release. See docs/changelog.md for details.");
  }

  lines.push("");
  lines.push("Full changelog: docs/changelog.md");
  lines.push('Quick start: Try /vortex-ado/ado-check or say "Draft test cases for User Story #12345".');
  return lines;
}

export function registerSetupTools(server: McpServer) {
  server.registerTool(
    "ado_connect",
    {
      title: "Connect to Azure DevOps",
      description: "Open a beautiful web UI to configure ADO and Confluence credentials with real-time connection testing. This is the recommended way to set up your credentials.",
      inputSchema: {},
    },
    async () => {
      try {
        const url = await launchConfigUI();
        return {
          content: [{
            type: "text" as const,
            text: [
              "🚀 Configuration UI launched!",
              "",
              `Opening in your browser: ${url}`,
              "",
              "In the configuration UI you can:",
              "• Enter your Azure DevOps credentials (PAT, Organization, Project)",
              "• Optionally configure Confluence integration",
              "• Test connections before saving",
              "• Save credentials securely to ~/.vortex-ado/credentials.json",
              "",
              "After saving, restart Cursor to apply the changes.",
              "",
              "💡 The server will automatically close after 10 minutes of inactivity.",
            ].join("\n"),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to launch configuration UI: ${err}`,
          }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_connect_save",
    {
      title: "Save ADO Credentials (Manual)",
      description: "Create the credentials template file at ~/.vortex-ado/credentials.json. The user then edits it privately -- PAT is never passed through chat. For a better experience, use /vortex-ado/ado-connect instead.",
      inputSchema: {},
    },
    async () => {
      const credPath = createCredentialsTemplate();
      const alreadyValid = loadCredentials() !== null;

      if (alreadyValid) {
        return {
          content: [{
            type: "text" as const,
            text: `Credentials are already configured at: ${credPath}\n\nTo update them, edit the file directly or use /vortex-ado/ado-connect for a guided setup.`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: [
            `Credentials template created at: ${credPath}`,
            "",
            "Open this file and fill in your values:",
            "  - ado_pat: Your Azure DevOps Personal Access Token",
            "  - ado_org: Your ADO organization name (from https://dev.azure.com/{org})",
            "  - ado_project: Your ADO project name",
            "",
            "Confluence fields are optional -- leave empty if not needed.",
            "",
            "After saving the file, restart the MCP server in Cursor Settings > MCP.",
            "",
            "💡 Tip: Use /vortex-ado/ado-connect for a guided setup with connection testing.",
          ].join("\n"),
        }],
      };
    }
  );

  server.registerTool(
    "ado_check",
    {
      title: "Check ADO Setup Status",
      description: "Check if the VortexADO MCP server is fully configured and ready to use. Returns a deterministic status table + Overall verdict + Next Actions list.",
      inputSchema: {},
    },
    async () => {
      const currentVersion = getCurrentVersion();
      const status = computeSetupStatus();
      const creds = loadCredentials();

      const lines: string[] = [];

      // Preserve first-run welcome + version-update framing. These precede
      // the status block but never replace it — the table + Next Actions
      // always render so the agent has a deterministic payload to surface.
      if (creds) {
        const state = loadSetupState();
        const confluenceConfigured = isConfluenceConfigured(creds);
        if (!state) {
          lines.push(...buildFirstRunWelcome(currentVersion, confluenceConfigured));
          lines.push("");
        } else if (isNewerVersion(state.lastSeenVersion, currentVersion)) {
          lines.push(...buildUpdateMessage(currentVersion));
          lines.push("");
        }
        saveSetupState(currentVersion, state);
      } else {
        lines.push("VortexADO MCP — Setup Incomplete");
        lines.push("");
        lines.push("Core ADO tools will not work until this is resolved.");
        lines.push("");
      }

      lines.push(formatSetupStatus(status));

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
