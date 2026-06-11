/**
 * Keychain wrapper tests.
 *
 * Use the `__setKeychainBackendForTests` injection seam so tests run against
 * an in-memory store instead of the developer's real OS keychain. The
 * production keytar import is still loaded but is never called during tests.
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  keychain,
  __setKeychainBackendForTests,
  __resetKeychainBackend,
  __setSetPasswordTimeoutForTests,
  __resetSetPasswordTimeout,
  __setGetPasswordTimeoutForTests,
  __resetGetPasswordTimeout,
  type KeychainBackend,
} from "./keychain.ts";

const store = new Map<string, string>();
function key(service: string, account: string) {
  return `${service}::${account}`;
}

const fakeBackend: KeychainBackend = {
  async getPassword(service, account) {
    return store.get(key(service, account)) ?? null;
  },
  async setPassword(service, account, password) {
    store.set(key(service, account), password);
  },
  async deletePassword(service, account) {
    return store.delete(key(service, account));
  },
  async findCredentials(service) {
    const prefix = `${service}::`;
    return [...store.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ account: k.slice(prefix.length), password: v }));
  },
};

before(() => __setKeychainBackendForTests(fakeBackend));
after(() => __resetKeychainBackend());
beforeEach(() => store.clear());

test("keychain: setAdoToken stores at vortex-ado/ado::{org}::{project}", async () => {
  await keychain.setAdoToken("MarsDevTeam", "TPM Product Ecosystem", "pat-abc");
  assert.equal(store.get("vortex-ado::ado::MarsDevTeam::TPM Product Ecosystem"), "pat-abc");
});

test("keychain: getAdoToken returns null when nothing stored", async () => {
  const token = await keychain.getAdoToken("Empty", "NoProject");
  assert.equal(token, null);
});

test("keychain: getAdoToken returns the stored value", async () => {
  await keychain.setAdoToken("Org1", "Proj1", "secret-1");
  assert.equal(await keychain.getAdoToken("Org1", "Proj1"), "secret-1");
});

test("keychain: two projects in same org coexist (different keys)", async () => {
  await keychain.setAdoToken("MarsDevTeam", "Project_ABC", "pat-abc");
  await keychain.setAdoToken("MarsDevTeam", "Project_XYZ", "pat-xyz");

  assert.equal(await keychain.getAdoToken("MarsDevTeam", "Project_ABC"), "pat-abc");
  assert.equal(await keychain.getAdoToken("MarsDevTeam", "Project_XYZ"), "pat-xyz");
  assert.equal(store.size, 2);
});

test("keychain: same project name in different orgs are distinct", async () => {
  await keychain.setAdoToken("Org-A", "SharedName", "token-A");
  await keychain.setAdoToken("Org-B", "SharedName", "token-B");

  assert.equal(await keychain.getAdoToken("Org-A", "SharedName"), "token-A");
  assert.equal(await keychain.getAdoToken("Org-B", "SharedName"), "token-B");
});

test("keychain: deleteAdoToken removes entry", async () => {
  await keychain.setAdoToken("Org", "Proj", "token");
  const removed = await keychain.deleteAdoToken("Org", "Proj");
  assert.equal(removed, true);
  assert.equal(await keychain.getAdoToken("Org", "Proj"), null);
});

test("keychain: deleteAdoToken returns false when nothing to delete", async () => {
  const removed = await keychain.deleteAdoToken("Org", "Proj");
  assert.equal(removed, false);
});

test("keychain: setConfluenceToken uses confluence:: prefix (distinct from ADO)", async () => {
  await keychain.setAdoToken("Org", "Proj", "ado-pat");
  await keychain.setConfluenceToken("Org", "Proj", "confluence-token");

  assert.equal(store.get("vortex-ado::ado::Org::Proj"), "ado-pat");
  assert.equal(store.get("vortex-ado::confluence::Org::Proj"), "confluence-token");
  assert.equal(store.size, 2);
});

test("keychain: getConfluenceToken null when only ADO stored", async () => {
  await keychain.setAdoToken("Org", "Proj", "ado-pat");
  assert.equal(await keychain.getConfluenceToken("Org", "Proj"), null);
});

test("keychain: findCredentials lists all entries under vortex-ado", async () => {
  await keychain.setAdoToken("Org1", "P1", "t1");
  await keychain.setAdoToken("Org2", "P2", "t2");
  await keychain.setConfluenceToken("Org1", "P1", "ct1");

  const all = await keychain.findCredentials();
  assert.equal(all.length, 3);

  const accounts = all.map((c) => c.account).sort();
  assert.deepEqual(accounts, [
    "ado::Org1::P1",
    "ado::Org2::P2",
    "confluence::Org1::P1",
  ]);
});

test("keychain: account key contains org and project literally (no escaping)", async () => {
  await keychain.setAdoToken("My Org", "Project / With Slash", "tok");
  assert.equal(store.get("vortex-ado::ado::My Org::Project / With Slash"), "tok");
  assert.equal(await keychain.getAdoToken("My Org", "Project / With Slash"), "tok");
});

test("keychain: setAdoToken overwrites existing entry for same key", async () => {
  await keychain.setAdoToken("Org", "Proj", "old");
  await keychain.setAdoToken("Org", "Proj", "new");
  assert.equal(await keychain.getAdoToken("Org", "Proj"), "new");
  assert.equal(store.size, 1);
});

// ── Timeout behavior ──────────────────────────────────────────────────
//
// macOS keytar can block forever when its system "allow access" prompt
// is hidden / the keychain is locked. set() must surface a useful error
// instead of letting the caller spin.

test("keychain: setAdoToken throws a clear error when setPassword hangs", async () => {
  // Backend whose setPassword never resolves — simulates a wedged
  // macOS keychain prompt.
  const hangingBackend: KeychainBackend = {
    async getPassword() {
      return null;
    },
    setPassword() {
      return new Promise(() => {
        /* never resolves */
      });
    },
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(hangingBackend);
  __setSetPasswordTimeoutForTests(50);
  try {
    await assert.rejects(
      () => keychain.setAdoToken("Org", "Proj", "tok"),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /Keychain write timed out/);
        // Includes the qualified account so users know which entry is stuck.
        assert.match(msg, /vortex-ado\/ado::Org::Proj/);
        // Points at the most likely cause and recovery path. The macOS
        // branch names Keychain Access; other platforms get a more
        // generic credential-store message.
        if (process.platform === "darwin") {
          assert.match(msg, /Keychain Access/);
        } else {
          assert.match(msg, /credential store/i);
        }
        return true;
      },
    );
  } finally {
    __resetSetPasswordTimeout();
    __setKeychainBackendForTests(fakeBackend);
  }
});

test("keychain: setConfluenceToken timeout error names the confluence:: account", async () => {
  const hangingBackend: KeychainBackend = {
    async getPassword() {
      return null;
    },
    setPassword() {
      return new Promise(() => {
        /* never resolves */
      });
    },
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(hangingBackend);
  __setSetPasswordTimeoutForTests(50);
  try {
    await assert.rejects(
      () => keychain.setConfluenceToken("Org", "Proj", "tok"),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /vortex-ado\/confluence::Org::Proj/);
        return true;
      },
    );
  } finally {
    __resetSetPasswordTimeout();
    __setKeychainBackendForTests(fakeBackend);
  }
});

// ── Read-side timeout (mirrors the write-side cases) ──────────────────
//
// Reads must also be bounded — a hidden macOS keychain access dialog
// blocks getPassword indefinitely. Symmetric to the write fix above.

test("keychain: getAdoToken throws a read-timeout error when getPassword hangs", async () => {
  const hangingBackend: KeychainBackend = {
    getPassword() {
      return new Promise(() => {
        /* never resolves — simulates hidden allow-access? prompt */
      });
    },
    async setPassword() {},
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(hangingBackend);
  __setGetPasswordTimeoutForTests(50);
  try {
    await assert.rejects(
      () => keychain.getAdoToken("Org", "Proj"),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // Read-side message uses the word "read" specifically — distinct
        // from the write-side timeout message.
        assert.match(msg, /Keychain read timed out/);
        assert.match(msg, /vortex-ado\/ado::Org::Proj/);
        // Recovery hint differs from the write-side: focuses on Access
        // Control / Allow all applications, not on deleting the entry.
        if (process.platform === "darwin") {
          assert.match(msg, /Access Control/);
        } else {
          assert.match(msg, /credential store/i);
        }
        return true;
      },
    );
  } finally {
    __resetGetPasswordTimeout();
    __setKeychainBackendForTests(fakeBackend);
  }
});

test("keychain: getConfluenceToken read timeout names the confluence:: account", async () => {
  const hangingBackend: KeychainBackend = {
    getPassword() {
      return new Promise(() => {
        /* never resolves */
      });
    },
    async setPassword() {},
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(hangingBackend);
  __setGetPasswordTimeoutForTests(50);
  try {
    await assert.rejects(
      () => keychain.getConfluenceToken("Org", "Proj"),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /vortex-ado\/confluence::Org::Proj/);
        return true;
      },
    );
  } finally {
    __resetGetPasswordTimeout();
    __setKeychainBackendForTests(fakeBackend);
  }
});

test("keychain: findCredentials is bounded by the same read timeout", async () => {
  // findCredentials walks every entry under the service and reads each,
  // so a stuck entry hangs the whole call. Verify the wrapper applies.
  const hangingBackend: KeychainBackend = {
    async getPassword() {
      return null;
    },
    async setPassword() {},
    async deletePassword() {
      return false;
    },
    findCredentials() {
      return new Promise(() => {
        /* never resolves */
      });
    },
  };
  __setKeychainBackendForTests(hangingBackend);
  __setGetPasswordTimeoutForTests(50);
  try {
    await assert.rejects(
      () => keychain.findCredentials(),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /Keychain read timed out/);
        assert.match(msg, /findCredentials/);
        return true;
      },
    );
  } finally {
    __resetGetPasswordTimeout();
    __setKeychainBackendForTests(fakeBackend);
  }
});
