import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getTcDraftsDir,
  loadCredentialsForWorkspace,
  type Credentials,
} from "../credentials.ts";
import { dirname, join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getCurrentVersion, getLatestChangelogHighlights, isNewerVersion } from "../version.ts";
import { launchConfigUI } from "./configure-ui.ts";
import { fetchClientRoots } from "../workspace/fetch-roots.ts";
import { resolveWorkspace } from "../workspace/resolve.ts";
import { WorkspaceError } from "../workspace/errors.ts";

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
 * Inputs to `computeSetupStatus`. `creds` and `tcDraftsPath` are dependency-
 * injected so tests can pin a deterministic shape; `workspaceConfigPath` is
 * the resolved path of `<workspaceRoot>/.vortex-ado/config.json` for the
 * "broken" message ("Not found at …"). Production callers always pass
 * `creds` (resolved via `loadCredentialsForWorkspace`) and
 * `workspaceConfigPath` (the path they read from).
 */
export interface SetupStatusDeps {
  creds?: Credentials | null;
  workspaceConfigPath?: string;
  tcDraftsPath?: string | null;
}

/**
 * Compute the deterministic setup status. Pure given `deps` — no global
 * state, no filesystem reads beyond what's injected. Returning a typed
 * object (rather than a prose blob) lets the caller render a consistent
 * table + remediation list and lets tests pin the exact verdict for each
 * input shape.
 */
export function computeSetupStatus(deps: SetupStatusDeps = {}): SetupStatus {
  const creds = deps.creds ?? null;
  const wsPath = deps.workspaceConfigPath ?? "<workspace>/.vortex-ado/config.json";
  const rows: SetupRow[] = [];
  const nextActions: string[] = [];

  if (!creds) {
    // Broken state — required credentials missing or invalid for this workspace.
    rows.push({
      name: "Workspace config",
      status: "fail",
      detail: `Not found or incomplete at ${wsPath}`,
    });
    rows.push({ name: "ADO PAT", status: "fail", detail: "Not configured (OS keychain has no entry for this workspace's org/project)" });
    rows.push({ name: "ADO Organization", status: "fail", detail: "Not configured" });
    rows.push({ name: "ADO Project", status: "fail", detail: "Not configured" });

    nextActions.push(
      "Run `/vortex-ado/ado-connect` to write `<workspace>/.vortex-ado/config.json` and store your PAT in the OS keychain.",
    );

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
      "Optional: re-run `/vortex-ado/ado-connect` and enable Confluence (URL + email) to enable Solution Design fetch. The API token will be stored in the OS keychain.",
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

/**
 * Path of the install-level state file used to drive the first-run
 * welcome and version-update messages. Lives in `~/.vortex-ado/`
 * alongside the bundled dist; we don't put it under the user's
 * workspace because it's per-MCP-install state, not per-project.
 */
function getStateFilePath(): string {
  return join(homedir(), ".vortex-ado", INITIALIZED_FLAG);
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
      description:
        "Open a guided web UI to configure ADO and Confluence credentials with real-time connection testing. " +
        "Writes <workspace>/.vortex-ado/config.json and stores the PAT in the OS keychain. " +
        "Resolves the target workspace via the MCP roots/list protocol (the workspace folder Cursor has open) " +
        "with `workspaceRoot` as an optional override for testing or power-user multi-workspace flows.",
      inputSchema: {
        workspaceRoot: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional override: absolute path of the project folder to configure. " +
              "Normally the workspace is auto-detected via MCP roots/list (whatever folder Cursor has open). " +
              "Pass this only to target a different folder, or when running from a client that doesn't expose roots.",
          ),
      },
    },
    async ({ workspaceRoot }, extra) => {
      try {
        // 1. Try MCP roots/list first (Cursor's blessed mechanism).
        // 2. Fall back to explicit `workspaceRoot` arg.
        // 3. Hard fail with a clear error if neither resolves.
        const clientRoots = await fetchClientRoots(extra ?? {});
        let resolved: string;
        try {
          resolved = resolveWorkspace({
            clientRoots,
            explicit: workspaceRoot,
          });
        } catch (err) {
          if (err instanceof WorkspaceError) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `❌ Could not determine the workspace to configure.\n\n` +
                    `Reason: ${err.message}\n\n` +
                    `Either open your project folder in Cursor (so MCP roots/list can resolve it) ` +
                    `or pass \`workspaceRoot\` as an absolute path argument explicitly.`,
                },
              ],
              isError: true,
            };
          }
          throw err;
        }

        const url = await launchConfigUI(resolved);
        const source = clientRoots.length > 0 ? "MCP roots/list" : "explicit workspaceRoot arg";
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "🚀 Configuration UI launched!",
                "",
                `Opening in your browser: ${url}`,
                "",
                `Workspace: ${resolved}`,
                `Resolved via: ${source}`,
                `Config will be written to: ${resolved}/.vortex-ado/config.json`,
                `PAT will be stored in the OS keychain (account: ado::{org}::{project}).`,
                "",
                "In the configuration UI you can:",
                "• Enter your Azure DevOps credentials (PAT, Organization, Project)",
                "• Optionally configure Confluence integration",
                "• Test connections before saving",
                "",
                "After saving, restart Cursor to apply the changes.",
                "",
                "💡 The server will automatically close after 10 minutes of inactivity.",
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to launch configuration UI: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_check",
    {
      title: "Check ADO Setup Status",
      description:
        "Check if the VortexADO MCP server is fully configured and ready to use. " +
        "Returns a deterministic status table + Overall verdict + Next Actions list. " +
        "Resolves the target workspace via MCP roots/list automatically (whatever folder Cursor has open). " +
        "Pass `workspaceRoot` only as an override to inspect a specific folder.",
      inputSchema: {
        workspaceRoot: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional override: absolute path of the project folder to check. " +
              "Normally auto-detected via MCP roots/list. Pass this to inspect a specific workspace " +
              "different from the one Cursor has open.",
          ),
      },
    },
    async ({ workspaceRoot }, extra) => {
      const currentVersion = getCurrentVersion();

      // Resolve the workspace via roots/list first, then explicit override.
      // No fallback path beyond that — without a workspace we can't read
      // any config, and there's no legacy file to fall back to.
      const clientRoots = await fetchClientRoots(extra ?? {});
      let resolvedWorkspace: string | null = null;
      let workspaceResolutionSource: string | null = null;
      try {
        resolvedWorkspace = resolveWorkspace({
          clientRoots,
          explicit: workspaceRoot,
        });
        workspaceResolutionSource = clientRoots.length > 0 ? "MCP roots/list" : "explicit workspaceRoot arg";
      } catch {
        // Workspace unresolved — surface that in the status output.
      }

      let creds: Credentials | null = null;
      let credsSource: string | null = null;
      let credsError: string | null = null;
      let wsConfigPath: string | undefined;
      if (resolvedWorkspace) {
        wsConfigPath = join(resolvedWorkspace, ".vortex-ado", "config.json");
        const result = await loadCredentialsForWorkspace(resolvedWorkspace);
        creds = result.credentials;
        credsSource = result.source;
        credsError = result.error;
      }

      const status = computeSetupStatus({ creds, workspaceConfigPath: wsConfigPath });
      const lines: string[] = [];

      if (resolvedWorkspace) {
        lines.push(`Workspace: ${resolvedWorkspace}`);
        lines.push(`Resolved via: ${workspaceResolutionSource}`);
        lines.push(`Credentials source: ${credsSource ?? "(none found)"}`);
        if (credsError) {
          // Workspace IS configured but reading credentials failed —
          // make this loud so users don't chase the wrong fix.
          lines.push(`⚠  Credential read error: ${credsError}`);
        }
        lines.push("");
      } else {
        lines.push("Workspace: (not resolved — open a folder in Cursor or pass `workspaceRoot`)");
        lines.push("");
      }

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
        if (resolvedWorkspace) {
          lines.push(
            `No per-workspace config found at ${resolvedWorkspace}/.vortex-ado/config.json. ` +
              `Run /vortex-ado/ado-connect to set up — the workspace is auto-detected from your open folder.`,
          );
        } else {
          lines.push("Core ADO tools will not work until a workspace is resolved and credentials are configured.");
        }
        lines.push("");
      }

      lines.push(formatSetupStatus(status));

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
