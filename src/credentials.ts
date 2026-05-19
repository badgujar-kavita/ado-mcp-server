/**
 * Credentials loader. Single source of truth: per-workspace config at
 * `<workspaceRoot>/.vortex-ado/config.json` + OS keychain for the PAT
 * and Confluence token.
 *
 * No legacy file fallback. No cwd-based resolution. No boot-time cache.
 * Every credential read is per-call and per-workspace, driven by the
 * `workspaceRoot` the agent passes (or the path resolved from the
 * MCP `roots/list` protocol).
 *
 * Pre-keychain installs that still have a stale `~/.vortex-ado/credentials.json`
 * placeholder file: that file is no longer read or referenced. Users with
 * legacy installs should run `/vortex-ado/ado-connect` once to populate the
 * per-workspace config and keychain entry; the legacy file can then be
 * deleted (it's harmless either way).
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { WorkspaceConfigSchema } from "./config/schema.ts";
import { keychain } from "./keychain/keychain.ts";

export interface Credentials {
  ado_pat: string;
  ado_org: string;
  ado_project: string;
  confluence_base_url?: string;
  confluence_email?: string;
  confluence_api_token?: string;
  tc_drafts_path?: string;
}

/**
 * User-configured tc-drafts path from env. Returns null when not set
 * (no hardcoded default). The previous `tc_drafts_path` field on the
 * legacy credentials file is no longer consulted.
 */
export function getTcDraftsDir(): string | null {
  const fromEnv = process.env.TC_DRAFTS_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);
  return null;
}

/**
 * One-shot async lookup for credentials at an explicit workspace path.
 *
 * Reads `<workspaceRoot>/.vortex-ado/config.json` for the org/project
 * scaffolding, then fetches the matching PAT and (when enabled) Confluence
 * token from the OS keychain. Returns `{ credentials: null, source: null }`
 * when the workspace config is missing, malformed, or the keychain has
 * no PAT for the configured org/project.
 *
 * The `source` string is a human-readable diagnostic for `/ado-check`.
 */
export async function loadCredentialsForWorkspace(
  workspaceRoot: string,
): Promise<{ credentials: Credentials | null; source: string | null }> {
  const wsPath = join(workspaceRoot, ".vortex-ado", "config.json");
  if (!existsSync(wsPath)) {
    return { credentials: null, source: null };
  }
  try {
    const raw = JSON.parse(readFileSync(wsPath, "utf-8"));
    const ws = WorkspaceConfigSchema.parse(raw);
    if (!ws.ado?.org || !ws.ado?.project) {
      return { credentials: null, source: null };
    }
    const pat = await keychain.getAdoToken(ws.ado.org, ws.ado.project);
    if (!pat) {
      return { credentials: null, source: null };
    }
    const confluenceToken = ws.confluence?.enabled
      ? await keychain.getConfluenceToken(ws.ado.org, ws.ado.project)
      : null;
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
  } catch {
    return { credentials: null, source: null };
  }
}
