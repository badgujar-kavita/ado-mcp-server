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

/**
 * Hard ceiling on a single keychain write. macOS surfaces a system dialog
 * the first time a process writes a new keychain account; if the dialog
 * is hidden behind another window, on a different desktop, suppressed by
 * MDM policy, or the login keychain is locked, `keytar.setPassword`
 * blocks indefinitely. Callers (the Connection wizard) currently spin
 * forever with no error. We bound the wait to a few seconds and surface
 * a useful message instead.
 */
const SET_PASSWORD_TIMEOUT_DEFAULT_MS = 10_000;
let setPasswordTimeoutMs = SET_PASSWORD_TIMEOUT_DEFAULT_MS;

/** Test seam — shorten the keychain-write timeout so timeout cases run fast. */
export function __setSetPasswordTimeoutForTests(ms: number): void {
  setPasswordTimeoutMs = ms;
}

/** Restore the production timeout (test cleanup). */
export function __resetSetPasswordTimeout(): void {
  setPasswordTimeoutMs = SET_PASSWORD_TIMEOUT_DEFAULT_MS;
}

/**
 * Same hard ceiling on a single keychain read. Reads can also block on
 * macOS: `SecKeychainFindGenericPassword` triggers an interactive "allow
 * access?" dialog when the calling binary's code signature isn't in the
 * entry's ACL. That happens for entries written before the
 * `broadenKeychainAclMacOnly()` fix landed (commit 79bd4ac), or when
 * `security set-generic-password-partition-list` failed silently, or
 * when MDM policy strips the broadened ACL. The dialog blocks the
 * native call indefinitely. Same Promise.race contract as writes.
 */
const GET_PASSWORD_TIMEOUT_DEFAULT_MS = 10_000;
let getPasswordTimeoutMs = GET_PASSWORD_TIMEOUT_DEFAULT_MS;

/** Test seam — shorten the keychain-read timeout so timeout cases run fast. */
export function __setGetPasswordTimeoutForTests(ms: number): void {
  getPasswordTimeoutMs = ms;
}

/** Restore the production read timeout (test cleanup). */
export function __resetGetPasswordTimeout(): void {
  getPasswordTimeoutMs = GET_PASSWORD_TIMEOUT_DEFAULT_MS;
}

/**
 * Cap on the macOS `security set-generic-password-partition-list` ACL
 * widening. Already non-fatal; the timeout just prevents a wedged
 * `security` invocation from blocking the rest of the save.
 */
const ACL_BROADEN_TIMEOUT_MS = 5_000;

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

/**
 * True when a test has swapped the backend out from under us. When true,
 * `set()` skips the macOS ACL-widening step — there's no real keychain
 * entry for `security` to find, so the call just stalls until the
 * `exec` timeout kills it (adds ~5s to every test).
 */
let backendIsReal = true;

/** Test seam — swap the backend out before any keychain function runs. */
export function __setKeychainBackendForTests(b: KeychainBackend): void {
  backend = b;
  backendIsReal = false;
}

/** Restore the production keytar backend (test cleanup). */
export function __resetKeychainBackend(): void {
  backend = keytarBackend;
  backendIsReal = true;
}

function accountFor(provider: Provider, org: string, project: string): string {
  return `${provider}::${org}::${project}`;
}

async function get(provider: Provider, org: string, project: string): Promise<string | null> {
  const account = accountFor(provider, org, project);
  return withTimeout(
    backend.getPassword(SERVICE, account),
    getPasswordTimeoutMs,
    () => new Error(readTimeoutMessageFor(account)),
  );
}

async function set(
  provider: Provider,
  org: string,
  project: string,
  secret: string,
): Promise<void> {
  const account = accountFor(provider, org, project);
  await withTimeout(
    backend.setPassword(SERVICE, account, secret),
    setPasswordTimeoutMs,
    () => new Error(timeoutMessageFor(account)),
  );
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
 * Build the platform-appropriate error string for a hung keychain write.
 * macOS is the only platform that surfaces an interactive system dialog
 * for a fresh entry, so the recovery steps differ per platform.
 */
function timeoutMessageFor(account: string): string {
  const head = `Keychain write timed out after ${setPasswordTimeoutMs / 1000}s for ${SERVICE}/${account}.`;
  if (process.platform === "darwin") {
    return (
      `${head} A macOS keychain prompt is likely hidden behind another window, on a different desktop, suppressed by MDM policy, or the login keychain is locked. ` +
      `Open Keychain Access, unlock the login keychain, and delete any stale "${SERVICE}" entry for this account before retrying.`
    );
  }
  return `${head} The OS credential store is not responding — verify it's running and accessible, then retry.`;
}

/**
 * Read-side counterpart. Different recovery hint: the entry already
 * exists, so the user probably needs to widen its ACL (so future reads
 * don't prompt) or recreate it via /ado-connect rather than delete a
 * "stale" entry. That's the symptom we hit when an entry was written by
 * a build that pre-dates `broadenKeychainAclMacOnly()`.
 */
function readTimeoutMessageFor(account: string): string {
  const head = `Keychain read timed out after ${getPasswordTimeoutMs / 1000}s for ${SERVICE}/${account}.`;
  if (process.platform === "darwin") {
    return (
      `${head} A macOS "allow access?" prompt for this entry is likely hidden behind another window, on a different desktop, or the login keychain is locked. ` +
      `Recover via Keychain Access: search "${SERVICE}", double-click the matching entry, open the Access Control tab, select "Allow all applications," save, and retry. ` +
      `If that fails, delete the entry and re-run /vortex-ado/ado-connect to recreate it with the broadened ACL.`
    );
  }
  return `${head} The OS credential store is not responding — verify it's running and accessible, then retry.`;
}

/**
 * Race a promise against a timer. If the timer fires first, throw the
 * error produced by `errorFactory`. Otherwise resolve/reject with the
 * underlying promise. The losing branch is allowed to settle in the
 * background — we deliberately don't try to "cancel" the keytar call
 * because the underlying native binding has no cancellation primitive.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  errorFactory: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(errorFactory()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  // No-op when a fake backend is installed (tests). The fake store has no
  // corresponding macOS keychain entry, so `security` would just stall
  // until the exec timeout kills it.
  if (!backendIsReal) return;
  const { exec } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    // Note: `security` looks up the entry by service+account and updates
    // the partition list in place. -k specifies the keychain — omitting
    // lets `security` use the default (login.keychain-db).
    const child = exec(
      `security set-generic-password-partition-list -S "apple:" -s ${shellQuote(SERVICE)} -a ${shellQuote(account)}`,
      { timeout: ACL_BROADEN_TIMEOUT_MS },
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
    // exec's `timeout` option SIGTERMs the child but the callback still
    // fires with the killed-process error, which we already swallow above.
    // No extra handling needed here — the listener silences the
    // unhandled-error case if exec errored before attaching stdio.
    child.on("error", () => {
      /* swallowed; reported via the exec callback above */
    });
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
  // credentials exist without leaking values. Bounded by the same read
  // timeout — `findCredentials` walks every entry under the service and
  // reads each, so it's exposed to the same hidden-prompt failure mode.
  async findCredentials(): Promise<Array<{ account: string; password: string }>> {
    return withTimeout(
      backend.findCredentials(SERVICE),
      getPasswordTimeoutMs,
      () => new Error(readTimeoutMessageFor(`${SERVICE} (findCredentials)`)),
    );
  },
};
