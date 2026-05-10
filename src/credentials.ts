/**
 * Credentials loader. Reads from per-workspace config + OS keychain when
 * available, falls back to legacy global ~/.vortex-ado/credentials.json
 * during Phase 1 migration.
 *
 * Why bootstrapped + sync:
 *   The keychain backend is async (keytar). The rest of the MCP code expects
 *   `loadCredentials()` to be synchronous because it's called from tool
 *   handlers and helpers throughout. To avoid changing every callsite, we
 *   load credentials ONCE at MCP startup via async `bootstrapCredentials()`
 *   and cache the result. Subsequent `loadCredentials()` calls are sync
 *   reads of that cache.
 *
 * Resolution order (per workspace, evaluated at bootstrap):
 *   1. <workspace>/.vortex-ado/config.json + keychain → canonical new path.
 *   2. ~/.vortex-ado/credentials.json → legacy fallback.
 *   3. null → no credentials available; tools surface clear errors.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { WorkspaceConfigSchema } from "./config/schema.ts";
import { keychain } from "./keychain/keychain.ts";

const LEGACY_CREDS_DIR = join(homedir(), ".vortex-ado");
const LEGACY_CREDS_FILE = join(LEGACY_CREDS_DIR, "credentials.json");

const PLACEHOLDER_VALUES = [
  "your-personal-access-token",
  "your-organization-name",
  "your-project-name",
];

export interface Credentials {
  ado_pat: string;
  ado_org: string;
  ado_project: string;
  confluence_base_url?: string;
  confluence_email?: string;
  confluence_api_token?: string;
  tc_drafts_path?: string;
}

/** Cached credentials populated by bootstrapCredentials() at MCP startup. */
let _credentials: Credentials | null = null;
let _credentialsSource: string | null = null;
let _bootstrapped = false;

/**
 * Workspace config path computed from process.cwd() (set by Cursor to the
 * open workspace folder).
 */
function workspaceConfigPath(): string {
  return join(process.cwd(), ".vortex-ado", "config.json");
}

/** Path to the legacy global credentials file. */
export function getCredentialsPath(): string {
  // Returns the workspace path when present, legacy path otherwise. Used by
  // /ado-check to tell the user where credentials live.
  const wsPath = workspaceConfigPath();
  return existsSync(wsPath) ? wsPath : LEGACY_CREDS_FILE;
}

/**
 * User-configured tc-drafts path from env or credentials. Returns null
 * when not set (no hardcoded default).
 */
export function getTcDraftsDir(): string | null {
  const fromEnv = process.env.TC_DRAFTS_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);

  const creds = loadCredentials();
  if (creds?.tc_drafts_path) return creds.tc_drafts_path;

  return null;
}

/**
 * Synchronous read of cached credentials. Must be called AFTER
 * bootstrapCredentials() has run, which happens once at MCP startup.
 *
 * If bootstrapCredentials() hasn't been called yet (e.g. in tests that
 * don't go through the index.ts boot path), this triggers a synchronous
 * legacy-file-only read so existing tests keep working.
 */
export function loadCredentials(): Credentials | null {
  if (_bootstrapped) return _credentials;

  // Lazy fallback for tests + first-call paths that didn't bootstrap.
  // Reads ONLY the legacy file (sync) — workspace config + keychain
  // require async bootstrap.
  return loadLegacyCredentialsSync();
}

/**
 * One-time async credential loader. Resolves keychain reads and caches
 * the result synchronously for subsequent `loadCredentials()` calls.
 *
 * Called from index.ts main() before any tool is registered.
 */
export async function bootstrapCredentials(): Promise<void> {
  // Step 1: try per-workspace config + keychain.
  const wsPath = workspaceConfigPath();
  if (existsSync(wsPath)) {
    try {
      const raw = JSON.parse(readFileSync(wsPath, "utf-8"));
      const ws = WorkspaceConfigSchema.parse(raw);
      if (ws.ado?.org && ws.ado?.project) {
        const pat = await keychain.getAdoToken(ws.ado.org, ws.ado.project);
        const confluenceToken = ws.confluence?.enabled
          ? await keychain.getConfluenceToken(ws.ado.org, ws.ado.project)
          : null;

        if (pat) {
          _credentials = {
            ado_pat: pat,
            ado_org: ws.ado.org,
            ado_project: ws.ado.project,
            ...(ws.confluence?.url ? { confluence_base_url: ws.confluence.url } : {}),
            ...(ws.confluence?.email ? { confluence_email: ws.confluence.email } : {}),
            ...(confluenceToken ? { confluence_api_token: confluenceToken } : {}),
          };
          _credentialsSource = `workspace+keychain (${wsPath})`;
          _bootstrapped = true;
          return;
        }
        // Workspace config exists but keychain has no PAT — likely partial
        // setup. Fall through to legacy fallback so the user isn't blocked.
      }
    } catch (err) {
      // Don't crash on a malformed workspace config — fall through to
      // legacy. The config loader will surface the parse error separately.
      // eslint-disable-next-line no-console
      console.error(
        `[VortexADO] Workspace config parse error at ${wsPath}; falling back to legacy credentials. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Step 2: legacy global file.
  const legacy = loadLegacyCredentialsSync();
  _credentials = legacy;
  _credentialsSource = legacy ? `legacy (${LEGACY_CREDS_FILE})` : null;
  _bootstrapped = true;
}

/** Synchronous legacy reader — used by both bootstrap and lazy fallback. */
function loadLegacyCredentialsSync(): Credentials | null {
  if (!existsSync(LEGACY_CREDS_FILE)) return null;

  try {
    const raw = readFileSync(LEGACY_CREDS_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    const pat = (data.ado_pat as string) ?? "";
    const org = (data.ado_org as string) ?? "";
    const project = (data.ado_project as string) ?? "";

    if (!pat || !org || !project) return null;
    if (
      PLACEHOLDER_VALUES.includes(pat) ||
      PLACEHOLDER_VALUES.includes(org) ||
      PLACEHOLDER_VALUES.includes(project)
    ) {
      return null;
    }

    const tcDraftsPathRaw = (data.tc_drafts_path as string)?.trim();
    const tcDraftsPath = tcDraftsPathRaw ? resolve(tcDraftsPathRaw) : undefined;

    return {
      ado_pat: pat,
      ado_org: org,
      ado_project: project,
      confluence_base_url: (data.confluence_base_url as string) || undefined,
      confluence_email: (data.confluence_email as string) || undefined,
      confluence_api_token: (data.confluence_api_token as string) || undefined,
      tc_drafts_path: tcDraftsPath,
    };
  } catch {
    return null;
  }
}

/** Diagnostic — where did credentials come from? Used by /ado-check. */
export function getCredentialsSource(): string | null {
  return _credentialsSource;
}

/** True when the legacy global credentials file exists on disk. */
export function credentialsFileExists(): boolean {
  return existsSync(LEGACY_CREDS_FILE);
}

/**
 * Create a placeholder legacy credentials.json template. Used by the
 * installer's first-run flow only. New tenants on Phase 1+ should use
 * /ado-connect, which writes per-workspace config + keychain instead.
 */
export function createCredentialsTemplate(): string {
  if (!existsSync(LEGACY_CREDS_DIR)) {
    mkdirSync(LEGACY_CREDS_DIR, { recursive: true });
  }

  if (!existsSync(LEGACY_CREDS_FILE)) {
    const template: Record<string, string> = {
      ado_pat: "your-personal-access-token",
      ado_org: "your-organization-name",
      ado_project: "your-project-name",
      confluence_base_url: "",
      confluence_email: "",
      confluence_api_token: "",
      tc_drafts_path: "",
    };
    writeFileSync(LEGACY_CREDS_FILE, JSON.stringify(template, null, 2) + "\n", "utf-8");
  }

  return LEGACY_CREDS_FILE;
}

/** Test seam — reset cache so tests can re-bootstrap with different state. */
export function __resetCredentialsCacheForTests(): void {
  _credentials = null;
  _credentialsSource = null;
  _bootstrapped = false;
}

/**
 * One-shot lookup for credentials at an explicit workspace path.
 *
 * Unlike `loadCredentials()` (which returns the cached startup-resolved
 * value), this freshly reads `<workspaceRoot>/.vortex-ado/config.json` and
 * fetches the matching keychain entry. Used by /ado-check (and Phase 1
 * tools) when the agent supplies `workspaceRoot` explicitly.
 *
 * Falls back to legacy global on miss, same as bootstrap.
 */
export async function loadCredentialsForWorkspace(
  workspaceRoot: string,
): Promise<{ credentials: Credentials | null; source: string | null }> {
  const wsPath = join(workspaceRoot, ".vortex-ado", "config.json");
  if (existsSync(wsPath)) {
    try {
      const raw = JSON.parse(readFileSync(wsPath, "utf-8"));
      const ws = WorkspaceConfigSchema.parse(raw);
      if (ws.ado?.org && ws.ado?.project) {
        const pat = await keychain.getAdoToken(ws.ado.org, ws.ado.project);
        const confluenceToken = ws.confluence?.enabled
          ? await keychain.getConfluenceToken(ws.ado.org, ws.ado.project)
          : null;

        if (pat) {
          return {
            credentials: {
              ado_pat: pat,
              ado_org: ws.ado.org,
              ado_project: ws.ado.project,
              ...(ws.confluence?.url ? { confluence_base_url: ws.confluence.url } : {}),
              ...(ws.confluence?.email ? { confluence_email: ws.confluence.email } : {}),
              ...(confluenceToken ? { confluence_api_token: confluenceToken } : {}),
            },
            source: `workspace+keychain (${wsPath})`,
          };
        }
      }
    } catch {
      // Fall through to legacy.
    }
  }

  const legacy = loadLegacyCredentialsSync();
  return {
    credentials: legacy,
    source: legacy ? `legacy (${LEGACY_CREDS_FILE})` : null,
  };
}
