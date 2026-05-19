/**
 * OS keychain gateway for ADO MCP secrets.
 *
 * Backed by `keytar` in production (macOS Keychain Services / Windows
 * Credential Manager / Linux libsecret). Tests inject an in-memory
 * KeychainBackend so `npm test` never touches the developer's real keychain.
 *
 * Keying convention:
 *   service = "vortex-ado"
 *   account = "{provider}::{org}::{project}"
 *
 * The (org, project) tuple uniquely identifies an ADO project — folder
 * names and tenant-chosen labels are NOT used. This means a single OS
 * keychain can hold credentials for many ADO projects in parallel,
 * including projects with the same name in different orgs.
 *
 * Examples:
 *   vortex-ado / ado::MarsDevTeam::TPM Product Ecosystem  → PAT
 *   vortex-ado / ado::MarsDevTeam::Marketing              → PAT
 *   vortex-ado / confluence::MarsDevTeam::TPM Product Ecosystem → API token
 *
 * Tokens never appear in any file on disk.
 */

import keytarModule from "keytar";

const SERVICE = "vortex-ado";

type Provider = "ado" | "confluence";

/**
 * Pluggable backend so tests can inject an in-memory implementation.
 * Production wires keytar's static functions through this interface.
 */
export interface KeychainBackend {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

/** Default backend backed by keytar. Native module loaded lazily. */
const keytarBackend: KeychainBackend = {
  getPassword: (service, account) => keytarModule.getPassword(service, account),
  setPassword: (service, account, password) => keytarModule.setPassword(service, account, password),
  deletePassword: (service, account) => keytarModule.deletePassword(service, account),
  findCredentials: (service) => keytarModule.findCredentials(service),
};

let backend: KeychainBackend = keytarBackend;

/** Test seam — swap the backend out before any keychain function runs. */
export function __setKeychainBackendForTests(b: KeychainBackend): void {
  backend = b;
}

/** Restore the production keytar backend (test cleanup). */
export function __resetKeychainBackend(): void {
  backend = keytarBackend;
}

function accountFor(provider: Provider, org: string, project: string): string {
  return `${provider}::${org}::${project}`;
}

async function get(provider: Provider, org: string, project: string): Promise<string | null> {
  return backend.getPassword(SERVICE, accountFor(provider, org, project));
}

async function set(
  provider: Provider,
  org: string,
  project: string,
  secret: string,
): Promise<void> {
  const account = accountFor(provider, org, project);
  await backend.setPassword(SERVICE, account, secret);
  // macOS only: relax the keychain ACL on this entry so reads from any
  // Apple-signed application (Cursor, Cursor Helper, Node, Terminal) do
  // NOT trigger an "always allow / deny / allow once" prompt every time
  // the MCP child reads the PAT. Without this, every tool call that
  // hits ADO triggers a Keychain prompt — blocking the QA workflow.
  // Standard practice for CLI tools that persist secrets in the OS
  // keychain (Git CM, AWS CLI, gcloud all do the equivalent).
  await broadenKeychainAclMacOnly(account);
}

/**
 * Broaden the macOS Keychain ACL on the just-written entry so subsequent
 * reads from differently-code-signed processes (e.g. a Node binary
 * upgraded between write and read, or Cursor's helper process vs the
 * main app) don't trigger interactive "allow access?" prompts.
 *
 * Uses the `security` CLI's `set-generic-password-partition-list` —
 * universally available on macOS. Partition list `apple:` means "any
 * Apple-signed application." This is the standard behavior CLI tools
 * adopt; the alternative (per-app whitelist) breaks on every Node
 * upgrade or Cursor reinstall.
 *
 * Non-fatal: failure here just means the user might see the prompt
 * occasionally — the credential is still written and readable. We
 * swallow errors and log a one-line warning.
 *
 * No-op on non-macOS — Linux libsecret and Windows Credential Manager
 * don't have this concept (keytar reads succeed silently there).
 */
async function broadenKeychainAclMacOnly(account: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const { exec } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    // Note: `security` looks up the entry by service+account and updates
    // the partition list in place. -k specifies the keychain — omitting
    // lets `security` use the default (login.keychain-db).
    exec(
      `security set-generic-password-partition-list -S "apple:" -s ${shellQuote(SERVICE)} -a ${shellQuote(account)}`,
      (err, _stdout, stderr) => {
        if (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[keychain] Could not broaden Keychain ACL for ${SERVICE}/${account}: ${stderr.trim() || err.message}. ` +
            `You may see Keychain access prompts; resolve via Keychain Access > vortex-ado entry > Access Control > Allow all applications.`,
          );
        }
        resolve();
      },
    );
  });
}

/** Single-quote a string for safe inclusion in a shell command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

async function del(provider: Provider, org: string, project: string): Promise<boolean> {
  return backend.deletePassword(SERVICE, accountFor(provider, org, project));
}

export const keychain = {
  // ADO PAT — primary credential, required by every workspace.
  getAdoToken(org: string, project: string) {
    return get("ado", org, project);
  },
  setAdoToken(org: string, project: string, token: string) {
    return set("ado", org, project, token);
  },
  deleteAdoToken(org: string, project: string) {
    return del("ado", org, project);
  },

  // Confluence API token — optional per workspace.
  // Keyed by (org, project) to allow different Confluence credentials
  // per ADO project even when they share an Atlassian instance.
  getConfluenceToken(org: string, project: string) {
    return get("confluence", org, project);
  },
  setConfluenceToken(org: string, project: string, token: string) {
    return set("confluence", org, project, token);
  },
  deleteConfluenceToken(org: string, project: string) {
    return del("confluence", org, project);
  },

  // List raw credentials under our service. Used by /ado-check to confirm
  // credentials exist without leaking values.
  async findCredentials(): Promise<Array<{ account: string; password: string }>> {
    return backend.findCredentials(SERVICE);
  },
};
