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

const INITIALIZED_FLAG = ".ado-testforge-initialized";

interface SetupState {
  initialized: boolean;
  lastSeenVersion: string;
  firstRunDate: string;
  lastCheckDate: string;
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

function buildDegradedMessage(details: string[]): string[] {
  return [
    "ADO TestForge MCP — Setup Incomplete",
    "",
    "Your ADO credentials are missing or invalid. Core ADO tools will not work until this is resolved.",
    "",
    "Details:",
    ...details.map((detail) => `- ${detail}`),
    "",
    "Run /ado-testforge/install or follow the setup guide: docs/setup-guide.md",
  ];
}

function buildFirstRunWelcome(version: string, confluenceConfigured: boolean): string[] {
  const contextLine = confluenceConfigured
    ? "ADO TestForge MCP connects Cursor IDE directly to Azure DevOps and Confluence — so you can draft, review, and push test cases without ever leaving your editor. It reads your User Stories, automatically pulls in linked Solution Design pages from Confluence for full business and technical context, follows your team's naming conventions, and handles all the ADO plumbing (folder structures, query-based suites, field mappings) so you can stay focused on test quality."
    : "ADO TestForge MCP connects Cursor IDE directly to Azure DevOps — so you can draft, review, and push test cases without ever leaving your editor. It reads your User Stories, understands your team's naming conventions, and handles all the ADO plumbing (folder structures, query-based suites, field mappings) so you can stay focused on test quality.";
  const getUserStoryLine = confluenceConfigured
    ? "/ado-testforge/get_user_story — Fetch a User Story with full QA context + Solution Design"
    : "/ado-testforge/get_user_story — Fetch a User Story with full QA context";
  const readinessLine = confluenceConfigured
    ? "Your AI-powered QA co-pilot is ready — with Confluence connected."
    : "Your AI-powered QA co-pilot is ready.";

  return [
    `Welcome to ADO TestForge MCP v${version}`,
    "",
    readinessLine,
    "",
    contextLine,
    "",
    "Think of it as the QA teammate who never forgets a convention, never skips a step, and works at the speed of your prompts.",
    "",
    "Two ways to work — pick what feels natural:",
    "- Slash command: /ado-testforge/draft_test_cases",
    '- Plain English: "Draft test cases for User Story #12345"',
    "",
    "Ready? Start here:",
    `- ${getUserStoryLine}`,
    "- /ado-testforge/draft_test_cases — Generate test cases ready for ADO",
    "- /ado-testforge/check_status — Verify your setup anytime",
    "",
    'Quick start: Try /ado-testforge/get_user_story or say "Draft test cases for User Story #12345".',
  ];
}

function buildUpdateMessage(version: string): string[] {
  const highlights = getLatestChangelogHighlights(5);
  const lines = [`What's New in ADO TestForge MCP v${version}`, ""];

  if (highlights.length > 0) {
    lines.push(...highlights.map((item) => `- ${item}`));
  } else {
    lines.push("- Improvements are available in this release. See docs/changelog.md for details.");
  }

  lines.push("");
  lines.push("Full changelog: docs/changelog.md");
  lines.push('Quick start: Try /ado-testforge/check_status or say "Draft test cases for User Story #12345".');
  return lines;
}

function appendReadyStatus(lines: string[], version: string, creds: Credentials, confluenceConfigured: boolean, briefHeaderOnly = false): void {
  if (briefHeaderOnly) {
    lines.push(`ADO TestForge MCP v${version} | Status: ✓ Ready`);
    lines.push("");
  } else {
    lines.push("");
    lines.push("Setup Status");
    lines.push("------------");
  }

  lines.push("ADO PAT: Configured");
  lines.push(`ADO Org: ${creds.ado_org}`);
  lines.push(`ADO Project: ${creds.ado_project}`);
  if (confluenceConfigured) {
    lines.push("Confluence: Configured");
  }
  const tcPath = getTcDraftsDir();
  lines.push(`TC Drafts: ${tcPath ?? "Use workspace (open folder) or set TC_DRAFTS_PATH"}`);

  if (!briefHeaderOnly) {
    lines.push("");
    lines.push("Status: READY — all tools and commands are available.");
  }
}

export function registerSetupTools(server: McpServer) {
  server.tool(
    "setup_credentials",
    "Create the credentials template file at ~/.ado-testforge-mcp/credentials.json. The user then edits it privately -- PAT is never passed through chat.",
    {},
    async () => {
      const credPath = createCredentialsTemplate();
      const alreadyValid = loadCredentials() !== null;

      if (alreadyValid) {
        return {
          content: [{
            type: "text" as const,
            text: `Credentials are already configured at: ${credPath}\n\nTo update them, edit the file directly.`,
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
          ].join("\n"),
        }],
      };
    }
  );

  server.tool(
    "check_setup_status",
    "Check if the ADO TestForge MCP server is fully configured and ready to use",
    {},
    async () => {
      const currentVersion = getCurrentVersion();
      const creds = loadCredentials();
      if (!creds) {
        const details = credentialsFileExists()
          ? [
              `Credentials file exists at ${getCredentialsPath()} but still contains placeholders or missing required values.`,
            ]
          : [
              `Credentials file not found at ${getCredentialsPath()}.`,
            ];

        return {
          content: [{ type: "text" as const, text: buildDegradedMessage(details).join("\n") }],
        };
      }

      const state = loadSetupState();
      const confluenceConfigured = isConfluenceConfigured(creds);
      const lines: string[] = [];

      if (!state) {
        lines.push(...buildFirstRunWelcome(currentVersion, confluenceConfigured));
        appendReadyStatus(lines, currentVersion, creds, confluenceConfigured);
        saveSetupState(currentVersion, state);
      } else if (isNewerVersion(state.lastSeenVersion, currentVersion)) {
        lines.push(...buildUpdateMessage(currentVersion));
        lines.push("");
        appendReadyStatus(lines, currentVersion, creds, confluenceConfigured, true);
        saveSetupState(currentVersion, state);
      } else {
        appendReadyStatus(lines, currentVersion, creds, confluenceConfigured, true);
        saveSetupState(currentVersion, state);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
