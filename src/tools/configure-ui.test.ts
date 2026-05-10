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
} from "./configure-ui.ts";

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
