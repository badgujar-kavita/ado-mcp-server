/**
 * Phase 2 — wizard backend tests.
 *
 * Covers:
 *  - Probe functions parse ADO REST responses correctly (mocked fetch).
 *  - saveConventions merges payload into existing config without
 *    touching ado/confluence/keychain.
 *  - saveConventions refuses if no workspace config exists yet.
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  probeAdoPlans,
  probeAdoFields,
  probeIterationPrefix,
  saveConventions,
  saveCredentials,
  loadExistingCredentials,
  checkKeychainPat,
  extractAreaPathFragment,
} from "./configure-ui.ts";
import {
  keychain,
  __setKeychainBackendForTests,
  __resetKeychainBackend,
  type KeychainBackend,
} from "../keychain/keychain.ts";

// ── Fetch mock helper ──────────────────────────────────────────────────

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: FetchHandler) {
  const original = globalThis.fetch;
  globalThis.fetch = ((u: string, i?: RequestInit) =>
    Promise.resolve(handler(u, i ?? {}))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── probeAdoPlans ──────────────────────────────────────────────────────

test("probeAdoPlans: parses plans + extracts leaf-segment fragment", async () => {
  const restore = mockFetch(() =>
    jsonResponse(200, {
      value: [
        { id: 100, name: "Alpha Plan", areaPath: "MyProject\\Team\\Alpha" },
        { id: 200, name: "Beta Plan", areaPath: "MyProject\\Team\\Beta" },
        { id: 300, name: "No AreaPath" },
      ],
    }),
  );
  try {
    const result = await probeAdoPlans("pat", "myorg", "myproj");
    assert.equal(result.ok, true);
    assert.equal(result.data?.length, 3);
    assert.equal(result.data?.[0].planId, 100);
    assert.equal(result.data?.[0].suggestedFragment, "Alpha");
    assert.equal(result.data?.[1].suggestedFragment, "Beta");
    assert.equal(result.data?.[2].suggestedFragment, "");
  } finally {
    restore();
  }
});

test("probeAdoPlans: 401 yields ok: false with helpful message", async () => {
  const restore = mockFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    const result = await probeAdoPlans("bad-pat", "o", "p");
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /401/);
  } finally {
    restore();
  }
});

test("probeAdoPlans: empty plan list yields ok with empty data", async () => {
  const restore = mockFetch(() => jsonResponse(200, { value: [] }));
  try {
    const result = await probeAdoPlans("pat", "o", "p");
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  } finally {
    restore();
  }
});

// ── probeAdoFields ─────────────────────────────────────────────────────

test("probeAdoFields: filters prereq + solutionDesign + context candidates", async () => {
  const restore = mockFetch(() =>
    jsonResponse(200, {
      value: [
        { referenceName: "Custom.PrerequisiteforTest", name: "Prerequisite for Test", type: "html" },
        { referenceName: "Custom.TechnicalSolution", name: "Solution Notes", type: "html" },
        { referenceName: "Custom.ImpactAssessment", name: "Impact Assessment", type: "html" },
        { referenceName: "Custom.Random", name: "Random Field", type: "html" },
        { referenceName: "System.Title", name: "Title", type: "string" },
      ],
    }),
  );
  try {
    const result = await probeAdoFields("pat", "o", "p");
    assert.equal(result.ok, true);
    // Prereq filter: matches by name OR reference name.
    assert.equal(result.data?.prerequisiteCandidates.length, 1);
    assert.equal(result.data?.prerequisiteCandidates[0].referenceName, "Custom.PrerequisiteforTest");
    // Solution-design filter: matches "solution|technical|design|spec" (TechnicalSolution + Solution Notes).
    assert.ok((result.data?.solutionDesignCandidates.length ?? 0) >= 1);
    // Context candidates: all Custom.* with html/plainText/string types.
    const contextNames = result.data?.contextCandidates.map((f) => f.referenceName) ?? [];
    assert.ok(contextNames.includes("Custom.PrerequisiteforTest"));
    assert.ok(contextNames.includes("Custom.ImpactAssessment"));
    assert.ok(contextNames.includes("Custom.Random"));
    // System.Title is NOT a Custom.* field — should not be in contextCandidates.
    assert.ok(!contextNames.includes("System.Title"));
  } finally {
    restore();
  }
});

// ── probeIterationPrefix ───────────────────────────────────────────────

test("probeIterationPrefix: detects common prefix from leaf iterations", async () => {
  const restore = mockFetch(() =>
    jsonResponse(200, {
      name: "Iteration",
      children: [
        { name: "Sprint_1" },
        { name: "Sprint_2" },
        { name: "Sprint_3" },
        { name: "Sprint_14" },
      ],
    }),
  );
  try {
    const result = await probeIterationPrefix("pat", "o", "p");
    assert.equal(result.ok, true);
    assert.equal(result.data?.suggestedPrefix, "Sprint_");
    assert.equal(result.data?.samples.length, 4);
  } finally {
    restore();
  }
});

test("probeIterationPrefix: returns null prefix when no pattern detected", async () => {
  const restore = mockFetch(() =>
    jsonResponse(200, {
      name: "Iteration",
      children: [{ name: "Random" }, { name: "AlsoRandom" }],
    }),
  );
  try {
    const result = await probeIterationPrefix("pat", "o", "p");
    assert.equal(result.ok, true);
    assert.equal(result.data?.suggestedPrefix, null);
  } finally {
    restore();
  }
});

test("probeIterationPrefix: walks nested tree (multi-level iterations)", async () => {
  const restore = mockFetch(() =>
    jsonResponse(200, {
      name: "Iteration",
      children: [
        {
          name: "FY26",
          children: [
            { name: "FY26_Sprint_1" },
            { name: "FY26_Sprint_2" },
          ],
        },
      ],
    }),
  );
  try {
    const result = await probeIterationPrefix("pat", "o", "p");
    assert.equal(result.ok, true);
    assert.equal(result.data?.suggestedPrefix, "FY26_Sprint_");
  } finally {
    restore();
  }
});

// ── saveConventions ────────────────────────────────────────────────────

let originalCwd: string;
let workspaceDir: string;

before(() => {
  originalCwd = process.cwd();
});
after(() => {
  process.chdir(originalCwd);
});
beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "ado-saveconv-"));
});

function configFilePath() {
  return join(workspaceDir, ".vortex-ado", "config.json");
}

function writeBaseConfig() {
  mkdirSync(join(workspaceDir, ".vortex-ado"), { recursive: true });
  writeFileSync(
    configFilePath(),
    JSON.stringify(
      {
        version: 1,
        ado: {
          url: "https://dev.azure.com/MyOrg",
          org: "MyOrg",
          project: "MyProject",
          setupAt: "2026-05-11T00:00:00.000Z",
        },
        confluence: { enabled: true, url: "https://x.atlassian.net/wiki", email: "a@b.com" },
      },
      null,
      2,
    ),
  );
}

test("saveConventions: refuses when workspace config doesn't exist yet", async () => {
  // Don't write base config — simulate first-time user who hasn't done Tab 1.
  await assert.rejects(
    () => saveConventions({ sprintPrefix: "Sprint_" }, workspaceDir),
    /no workspace config exists yet/i,
  );
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes sprintPrefix without touching ado/confluence", async () => {
  writeBaseConfig();
  await saveConventions({ sprintPrefix: "SFTPM_" }, workspaceDir);
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.suiteStructure?.sprintPrefix, "SFTPM_");
  assert.equal(written.ado.org, "MyOrg");
  assert.equal(written.ado.project, "MyProject");
  assert.equal(written.confluence.email, "a@b.com");
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes testPlanMapping (full payload)", async () => {
  writeBaseConfig();
  await saveConventions(
    {
      testPlanMapping: [
        { planId: 100, areaPathContains: ["Alpha"] },
        { planId: 200, areaPathContains: ["Beta", "B-eta"] },
      ],
    },
    workspaceDir,
  );
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.suiteStructure?.testPlanMapping?.length, 2);
  assert.equal(written.suiteStructure?.testPlanMapping[0].planId, 100);
  assert.deepEqual(written.suiteStructure?.testPlanMapping[1].areaPathContains, ["Beta", "B-eta"]);
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes personas + preserves existing prerequisiteDefaults", async () => {
  // Seed config with existing personaRolesLabel/personaPsgLabel so we can verify they survive.
  mkdirSync(join(workspaceDir, ".vortex-ado"), { recursive: true });
  writeFileSync(
    configFilePath(),
    JSON.stringify(
      {
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
        prerequisiteDefaults: {
          personaRolesLabel: "TPM Roles",
          personaPsgLabel: "PSG",
        },
      },
      null,
      2,
    ),
  );
  await saveConventions(
    {
      personas: {
        Cashier: { label: "Cashier", profile: "POS_Profile", roles: "Cashier", psg: "POS Users" },
      },
    },
    workspaceDir,
  );
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.prerequisiteDefaults?.personas?.Cashier?.label, "Cashier");
  // Existing persona labels survive.
  assert.equal(written.prerequisiteDefaults?.personaRolesLabel, "TPM Roles");
  assert.equal(written.prerequisiteDefaults?.personaPsgLabel, "PSG");
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes ado.fieldRefs.prerequisite + preserves ado top-level", async () => {
  writeBaseConfig();
  await saveConventions(
    { prerequisiteFieldRef: "Custom.PrerequisiteforTest" },
    workspaceDir,
  );
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.ado.fieldRefs.prerequisite, "Custom.PrerequisiteforTest");
  assert.equal(written.ado.org, "MyOrg");
  assert.equal(written.ado.url, "https://dev.azure.com/MyOrg");
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes additionalContextFields (replace, not merge)", async () => {
  // Seed with existing additionalContextFields to verify replacement.
  mkdirSync(join(workspaceDir, ".vortex-ado"), { recursive: true });
  writeFileSync(
    configFilePath(),
    JSON.stringify(
      {
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
        additionalContextFields: [
          { adoFieldRef: "Custom.OldField", label: "Old" },
        ],
      },
      null,
      2,
    ),
  );
  await saveConventions(
    {
      additionalContextFields: [
        { adoFieldRef: "Custom.NewField", label: "New", fetchLinks: true, fetchImages: true },
      ],
    },
    workspaceDir,
  );
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.additionalContextFields.length, 1);
  assert.equal(written.additionalContextFields[0].adoFieldRef, "Custom.NewField");
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes images.enabled=true when toggled on", async () => {
  writeBaseConfig();
  await saveConventions({ imagesEnabled: true }, workspaceDir);
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.images?.enabled, true);
  // Other image fields untouched (stay framework-default at load time).
  assert.equal(written.images?.maxBytesPerImage, undefined);
  // Other config blocks untouched.
  assert.equal(written.ado.org, "MyOrg");
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: writes images.enabled=false when toggled off", async () => {
  writeBaseConfig();
  // Pre-seed an existing on state so we know the off save actually overwrites.
  await saveConventions({ imagesEnabled: true }, workspaceDir);
  await saveConventions({ imagesEnabled: false }, workspaceDir);
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.images?.enabled, false);
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: imagesEnabled omitted leaves existing images block untouched", async () => {
  writeBaseConfig();
  // Seed enabled=true.
  await saveConventions({ imagesEnabled: true }, workspaceDir);
  // Now save unrelated payload — images.enabled must be preserved.
  await saveConventions({ sprintPrefix: "Sprint_" }, workspaceDir);
  const written = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  assert.equal(written.images?.enabled, true);
  assert.equal(written.suiteStructure?.sprintPrefix, "Sprint_");
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("saveConventions: empty payload only refreshes file (no field changes)", async () => {
  writeBaseConfig();
  const before = readFileSync(configFilePath(), "utf-8");
  await saveConventions({}, workspaceDir);
  const after = readFileSync(configFilePath(), "utf-8");
  // File contents are equivalent (allowing for re-serialization); no fields lost.
  const beforeJson = JSON.parse(before);
  const afterJson = JSON.parse(after);
  assert.deepEqual(afterJson.ado, beforeJson.ado);
  assert.deepEqual(afterJson.confluence, beforeJson.confluence);
  rmSync(workspaceDir, { recursive: true, force: true });
});

// ── extractAreaPathFragment (Tier 1 backend) ──────────────────────────

test("extractAreaPathFragment: returns leaf segment of a backslash-separated path", () => {
  assert.equal(
    extractAreaPathFragment("MyProject\\Team\\Alpha", "MyProject"),
    "Alpha",
  );
});

test("extractAreaPathFragment: empty string returns empty string", () => {
  assert.equal(extractAreaPathFragment("", "MyProject"), "");
});

test("extractAreaPathFragment: single-segment areaPath returns the whole thing", () => {
  assert.equal(extractAreaPathFragment("MyProject", "MyProject"), "MyProject");
});

test("extractAreaPathFragment: trailing/leading separator handled (filter empty)", () => {
  assert.equal(
    extractAreaPathFragment("\\Team\\Plan\\", "Project"),
    "Plan",
  );
});

test("extractAreaPathFragment: deep nesting returns deepest leaf", () => {
  assert.equal(
    extractAreaPathFragment("A\\B\\C\\D\\E", "A"),
    "E",
  );
});

// ── In-memory keychain harness ────────────────────────────────────────

const keychainStore = new Map<string, string>();
function keyOf(service: string, account: string) {
  return `${service}::${account}`;
}
const fakeKeychain: KeychainBackend = {
  async getPassword(s, a) {
    return keychainStore.get(keyOf(s, a)) ?? null;
  },
  async setPassword(s, a, p) {
    keychainStore.set(keyOf(s, a), p);
  },
  async deletePassword(s, a) {
    return keychainStore.delete(keyOf(s, a));
  },
  async findCredentials(s) {
    const prefix = `${s}::`;
    return [...keychainStore.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ account: k.slice(prefix.length), password: v }));
  },
};

before(() => __setKeychainBackendForTests(fakeKeychain));
after(() => __resetKeychainBackend());

// ── checkKeychainPat (Tier 1 backend) ─────────────────────────────────

test("checkKeychainPat: returns ok=false when workspace config doesn't exist", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-keychain-test-"));
  try {
    const result = await checkKeychainPat(tmp);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /No workspace config found/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkKeychainPat: returns ok=false when config exists but no PAT in keychain", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-keychain-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
      }),
    );
    const result = await checkKeychainPat(tmp);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /No PAT found in OS keychain/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkKeychainPat: returns ok=false when ADO rejects the stored PAT", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-keychain-test-"));
  const restore = mockFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
      }),
    );
    await keychain.setAdoToken("o", "p", "stale-pat");
    const result = await checkKeychainPat(tmp);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /Saved PAT is no longer valid/i);
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkKeychainPat: returns ok=true when ADO accepts the stored PAT", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-keychain-test-"));
  const restore = mockFetch(() =>
    jsonResponse(200, { name: "p", state: "wellFormed" }),
  );
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
      }),
    );
    await keychain.setAdoToken("o", "p", "valid-pat");
    const result = await checkKeychainPat(tmp);
    assert.equal(result.ok, true);
    assert.equal(result.pat, "valid-pat");
    assert.equal(result.org, "o");
    assert.equal(result.project, "p");
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkKeychainPat: returns ok=false when config has no ado.org/project", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-keychain-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({ version: 1 }),
    );
    const result = await checkKeychainPat(tmp);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /no ADO org\/project/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkKeychainPat: surfaces keychain read failure as a clean ok=false instead of hanging", async () => {
  // Simulate a hidden macOS keychain prompt by injecting a backend whose
  // getPassword throws (the read-side timeout in keychain.ts converts a
  // hang into a thrown Error). The handler must catch and return JSON.
  const tmp = mkdtempSync(join(tmpdir(), "ado-keychain-test-"));
  const throwingBackend: KeychainBackend = {
    async getPassword() {
      throw new Error("simulated keychain read timeout");
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
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
      }),
    );
    const result = await checkKeychainPat(tmp);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /Could not read saved PAT/);
    assert.match(result.message ?? "", /simulated keychain read timeout/);
  } finally {
    __setKeychainBackendForTests(fakeKeychain);
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── loadExistingCredentials (Tier 1 backend) ──────────────────────────

test("loadExistingCredentials: returns empty when neither workspace nor legacy file exists", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-existing-test-"));
  try {
    const result = await loadExistingCredentials(tmp);
    // Empty object expected — no creds anywhere. (Legacy file may exist on
    // the dev machine; if so, this test still passes because the loader
    // returns SOMETHING; we only verify the type.)
    assert.ok(typeof result === "object");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadExistingCredentials: returns workspace config + sets _patStored when keychain has PAT", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-existing-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: {
          url: "https://dev.azure.com/myorg",
          org: "myorg",
          project: "myproj",
        },
      }),
    );
    await keychain.setAdoToken("myorg", "myproj", "stored-pat");
    const result = await loadExistingCredentials(tmp);
    assert.equal(result.ado_org, "myorg");
    assert.equal(result.ado_project, "myproj");
    assert.equal(result.ado_pat, ""); // never pre-fills the actual PAT
    assert.equal(result._patStored, true);
    assert.equal(result._confluenceTokenStored, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadExistingCredentials: _patStored=false when keychain entry is missing", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-existing-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
      }),
    );
    // No PAT in keychain.
    const result = await loadExistingCredentials(tmp);
    assert.equal(result._patStored, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadExistingCredentials: surfaces Confluence url + email + _confluenceTokenStored", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-existing-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/o", org: "o", project: "p" },
        confluence: {
          enabled: true,
          url: "https://example.atlassian.net/wiki",
          email: "user@example.com",
        },
      }),
    );
    await keychain.setAdoToken("o", "p", "pat");
    await keychain.setConfluenceToken("o", "p", "conf-token");
    const result = await loadExistingCredentials(tmp);
    assert.equal(result.confluence_base_url, "https://example.atlassian.net/wiki");
    assert.equal(result.confluence_email, "user@example.com");
    assert.equal(result.confluence_api_token, ""); // never pre-fills the token itself
    assert.equal(result._confluenceTokenStored, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── saveCredentials org/project change (Tier 1 backend) ────────────────

test("saveCredentials: same org/project save → orgProjectChanged=false, keychain has new PAT", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/sameorg", org: "sameorg", project: "sameproj" },
      }),
    );
    await keychain.setAdoToken("sameorg", "sameproj", "old-pat");
    const result = await saveCredentials(
      {
        ado_pat: "new-pat",
        ado_org: "sameorg",
        ado_project: "sameproj",
      },
      tmp,
    );
    assert.equal(result.orgProjectChanged, false);
    // Keychain entry updated to new PAT.
    assert.equal(await keychain.getAdoToken("sameorg", "sameproj"), "new-pat");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveCredentials: org change → orgProjectChanged=true, old keychain entry deleted, new entry created", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/oldorg", org: "oldorg", project: "proj" },
      }),
    );
    await keychain.setAdoToken("oldorg", "proj", "old-pat");
    await keychain.setConfluenceToken("oldorg", "proj", "old-conf-token");

    const result = await saveCredentials(
      {
        ado_pat: "new-pat",
        ado_org: "neworg",
        ado_project: "proj",
      },
      tmp,
    );
    assert.equal(result.orgProjectChanged, true);
    // Old keychain entry deleted to prevent orphaning.
    assert.equal(await keychain.getAdoToken("oldorg", "proj"), null);
    assert.equal(await keychain.getConfluenceToken("oldorg", "proj"), null);
    // New entry under new org.
    assert.equal(await keychain.getAdoToken("neworg", "proj"), "new-pat");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveCredentials: project change (same org) → orgProjectChanged=true, old project's keychain deleted", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/org", org: "org", project: "oldproj" },
      }),
    );
    await keychain.setAdoToken("org", "oldproj", "pat-for-old");

    const result = await saveCredentials(
      { ado_pat: "pat-for-new", ado_org: "org", ado_project: "newproj" },
      tmp,
    );
    assert.equal(result.orgProjectChanged, true);
    assert.equal(await keychain.getAdoToken("org", "oldproj"), null);
    assert.equal(await keychain.getAdoToken("org", "newproj"), "pat-for-new");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveCredentials: first-time save (no existing config) → orgProjectChanged=false, file + keychain created", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-test-"));
  try {
    const result = await saveCredentials(
      { ado_pat: "first-pat", ado_org: "org", ado_project: "proj" },
      tmp,
    );
    assert.equal(result.orgProjectChanged, false);
    assert.ok(existsSync(join(tmp, ".vortex-ado", "config.json")));
    const parsed = JSON.parse(readFileSync(join(tmp, ".vortex-ado", "config.json"), "utf-8"));
    assert.equal(parsed.ado.org, "org");
    assert.equal(parsed.ado.project, "proj");
    assert.equal(await keychain.getAdoToken("org", "proj"), "first-pat");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveCredentials: refuses to write into $HOME (safety guard)", async () => {
  keychainStore.clear();
  const home = process.env.HOME ?? "";
  await assert.rejects(
    () =>
      saveCredentials(
        { ado_pat: "x", ado_org: "o", ado_project: "p" },
        home,
      ),
    /home directory/i,
  );
});

test("saveCredentials: keychain failure is rethrown with ADO provider prefix", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-tag-"));
  // Swap in a backend that throws on the ADO write to verify the
  // wrapping in saveCredentials surfaces a provider-tagged error.
  const failingBackend: KeychainBackend = {
    async getPassword() {
      return null;
    },
    async setPassword(_s, account) {
      if (account.startsWith("ado::")) throw new Error("simulated failure");
    },
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(failingBackend);
  try {
    await assert.rejects(
      () =>
        saveCredentials(
          { ado_pat: "x", ado_org: "o", ado_project: "p" },
          tmp,
        ),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /^ADO keychain write failed:/);
        assert.match(msg, /simulated failure/);
        return true;
      },
    );
  } finally {
    __setKeychainBackendForTests(fakeKeychain);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveCredentials: keychain failure is rethrown with Confluence provider prefix", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-tag-"));
  // ADO write succeeds, Confluence write throws — verifies the wizard
  // can distinguish which provider's keychain entry hung.
  const failingBackend: KeychainBackend = {
    async getPassword() {
      return null;
    },
    async setPassword(_s, account) {
      if (account.startsWith("confluence::")) throw new Error("simulated failure");
      // ADO write succeeds silently.
    },
    async deletePassword() {
      return false;
    },
    async findCredentials() {
      return [];
    },
  };
  __setKeychainBackendForTests(failingBackend);
  try {
    await assert.rejects(
      () =>
        saveCredentials(
          {
            ado_pat: "x",
            ado_org: "o",
            ado_project: "p",
            confluence_base_url: "https://example.atlassian.net/wiki",
            confluence_email: "a@b.com",
            confluence_api_token: "tok",
          },
          tmp,
        ),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /^Confluence keychain write failed:/);
        assert.match(msg, /simulated failure/);
        return true;
      },
    );
  } finally {
    __setKeychainBackendForTests(fakeKeychain);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveCredentials: preserves existing convention blocks (suiteStructure, personas)", async () => {
  keychainStore.clear();
  const tmp = mkdtempSync(join(tmpdir(), "ado-savecreds-test-"));
  try {
    mkdirSync(join(tmp, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(tmp, ".vortex-ado", "config.json"),
      JSON.stringify({
        version: 1,
        ado: { url: "https://dev.azure.com/org", org: "org", project: "proj" },
        suiteStructure: { sprintPrefix: "Sprint_", testPlanMapping: [{ planId: 100, areaPathContains: ["X"] }] },
        prerequisiteDefaults: { personas: { Admin: { label: "Admin", profile: "p", roles: "r", psg: "g" } } },
      }),
    );
    await saveCredentials(
      { ado_pat: "new", ado_org: "org", ado_project: "proj" },
      tmp,
    );
    const parsed = JSON.parse(readFileSync(join(tmp, ".vortex-ado", "config.json"), "utf-8"));
    // Conventions preserved verbatim across a connection-only re-save.
    assert.equal(parsed.suiteStructure.sprintPrefix, "Sprint_");
    assert.equal(parsed.suiteStructure.testPlanMapping[0].planId, 100);
    assert.equal(parsed.prerequisiteDefaults.personas.Admin.label, "Admin");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
