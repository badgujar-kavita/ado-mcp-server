/**
 * Tests for `loadCredentialsForWorkspace` — the single source of truth
 * the AdoClient proxy and `/ado-check` consult.
 *
 * Focus: the `error` field on the return shape. When the workspace is
 * configured but reading the keychain fails (hung macOS prompt), the
 * caller must see the error, not a misleading "credentials not configured."
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredentialsForWorkspace } from "./credentials.ts";
import {
  __setKeychainBackendForTests,
  __resetKeychainBackend,
  type KeychainBackend,
} from "./keychain/keychain.ts";

const store = new Map<string, string>();
const fakeKeychain: KeychainBackend = {
  async getPassword(s, a) {
    return store.get(`${s}::${a}`) ?? null;
  },
  async setPassword(s, a, p) {
    store.set(`${s}::${a}`, p);
  },
  async deletePassword(s, a) {
    return store.delete(`${s}::${a}`);
  },
  async findCredentials(s) {
    const pre = `${s}::`;
    return [...store.entries()]
      .filter(([k]) => k.startsWith(pre))
      .map(([k, v]) => ({ account: k.slice(pre.length), password: v }));
  },
};

before(() => __setKeychainBackendForTests(fakeKeychain));
after(() => __resetKeychainBackend());

function makeWorkspace(opts: {
  ado?: { org?: string; project?: string };
  confluence?: { enabled?: boolean; url?: string; email?: string };
  malformed?: boolean;
}): string {
  const tmp = mkdtempSync(join(tmpdir(), "creds-test-"));
  mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
  if (opts.malformed) {
    writeFileSync(join(tmp, ".vortex-ado", "config.json"), "{ not valid json");
  } else {
    const org = opts.ado?.org ?? "o";
    const project = opts.ado?.project ?? "p";
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: {
          url: `https://dev.azure.com/${org}`,
          org,
          project,
        },
        ...(opts.confluence ? { confluence: opts.confluence } : {}),
      }),
    );
  }
  return tmp;
}

test("loadCredentialsForWorkspace: no config file → error=null, credentials=null", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "creds-test-"));
  try {
    const result = await loadCredentialsForWorkspace(tmp);
    assert.equal(result.credentials, null);
    assert.equal(result.error, null);
    assert.equal(result.source, null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadCredentialsForWorkspace: malformed config → error populated, not silently null", async () => {
  const tmp = makeWorkspace({ malformed: true });
  try {
    const result = await loadCredentialsForWorkspace(tmp);
    assert.equal(result.credentials, null);
    assert.ok(result.error, "expected an error message");
    assert.match(result.error!, /Could not parse/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadCredentialsForWorkspace: config has no ado.org/project → error=null (genuinely unconfigured)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "creds-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({ version: 1 }),
    );
    const result = await loadCredentialsForWorkspace(tmp);
    assert.equal(result.credentials, null);
    assert.equal(result.error, null, "no org/project is 'unconfigured', not an error");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadCredentialsForWorkspace: keychain has no PAT → error=null (genuinely unconfigured)", async () => {
  store.clear();
  const tmp = makeWorkspace({});
  try {
    const result = await loadCredentialsForWorkspace(tmp);
    assert.equal(result.credentials, null);
    assert.equal(result.error, null, "missing keychain entry is 'unconfigured', not an error");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadCredentialsForWorkspace: keychain READ throws → error populated with the keychain message", async () => {
  // This is the critical case: workspace IS configured, but reading the
  // PAT from the keychain hung (or failed). Without the error field,
  // callers (the AdoClient proxy) say "credentials not configured" and
  // tell users to run /ado-connect — which won't help, since the entry
  // already exists.
  const throwingBackend: KeychainBackend = {
    async getPassword() {
      throw new Error("simulated keychain timeout");
    },
    async setPassword() {},
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(throwingBackend);
  const tmp = makeWorkspace({});
  try {
    const result = await loadCredentialsForWorkspace(tmp);
    assert.equal(result.credentials, null);
    assert.ok(result.error);
    assert.match(result.error!, /Could not read PAT from OS keychain/);
    assert.match(result.error!, /simulated keychain timeout/);
  } finally {
    __setKeychainBackendForTests(fakeKeychain);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadCredentialsForWorkspace: Confluence keychain read failure does NOT block ADO resolution", async () => {
  // Confluence is optional. A timeout reading its token must not poison
  // the ADO credentials — the user can still operate ADO tools while
  // Confluence is unavailable.
  store.clear();
  store.set("vortex-ado::ado::o::p", "valid-pat");
  // Backend returns the ADO PAT but throws on the Confluence read.
  const partialBackend: KeychainBackend = {
    async getPassword(_s, account) {
      if (account.startsWith("ado::")) return "valid-pat";
      throw new Error("simulated Confluence read failure");
    },
    async setPassword() {},
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(partialBackend);
  const tmp = makeWorkspace({
    confluence: { enabled: true, url: "https://x.atlassian.net/wiki", email: "a@b.com" },
  });
  try {
    const result = await loadCredentialsForWorkspace(tmp);
    assert.ok(result.credentials, "ADO PAT was readable, so result must succeed");
    assert.equal(result.credentials!.ado_pat, "valid-pat");
    assert.equal(result.credentials!.confluence_api_token, undefined, "Confluence token absent");
    assert.equal(result.error, null, "Confluence failure is logged, not surfaced as a blocking error");
  } finally {
    __setKeychainBackendForTests(fakeKeychain);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadCredentialsForWorkspace: happy path returns credentials + source, error=null", async () => {
  store.clear();
  store.set("vortex-ado::ado::myorg::myproj", "the-pat");
  const tmp = makeWorkspace({ ado: { org: "myorg", project: "myproj" } });
  try {
    const result = await loadCredentialsForWorkspace(tmp);
    assert.equal(result.credentials?.ado_pat, "the-pat");
    assert.equal(result.credentials?.ado_org, "myorg");
    assert.equal(result.credentials?.ado_project, "myproj");
    assert.equal(result.error, null);
    assert.match(result.source ?? "", /workspace\+keychain/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
