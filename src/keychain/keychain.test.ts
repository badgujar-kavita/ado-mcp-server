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
