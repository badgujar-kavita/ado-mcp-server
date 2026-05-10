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
  await backend.setPassword(SERVICE, accountFor(provider, org, project), secret);
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
