/**
 * Unit tests for the pure helper functions in src/helpers/suite-structure.ts.
 *
 * Self-contained: writes a fixture per-workspace config to a tmpdir, chdir's
 * into it, then exercises the helpers. The cache is reset between describe
 * setup/teardown so the fixture is the actual source of truth — no
 * dependency on `~/.vortex-ado/conventions.config.json` or any bundled file.
 *
 * Fixture mirrors realistic per-tenant values (sprintPrefix "S_", two plan
 * mappings) so the assertions verify the helpers' logic, not specific
 * production values.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSprintFolderName,
  buildParentUsFolderName,
  buildUsFolderName,
  getNonEpicFolderName,
  resolvePlanIdFromAreaPath,
  resolveSprintFromIteration,
  buildSuiteQueryString,
} from "../helpers/suite-structure.ts";
import { __resetConventionsCacheForTests } from "../config.ts";

describe("suite-structure helpers", () => {
  let originalCwd: string;
  let fixtureDir: string;

  before(() => {
    originalCwd = process.cwd();
    fixtureDir = mkdtempSync(join(tmpdir(), "ado-suite-test-"));
    mkdirSync(join(fixtureDir, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(fixtureDir, ".vortex-ado", "config.json"),
      JSON.stringify(
        {
          version: 1,
          ado: {
            url: "https://dev.azure.com/TestOrg",
            org: "TestOrg",
            project: "TestProject",
          },
          testCaseTitle: { prefix: "TC" },
          suiteStructure: {
            sprintPrefix: "S_",
            tcTitlePrefix: "TC",
            testPlanMapping: [
              { planId: 1001, areaPathContains: ["Alpha", "ALPHA"] },
              { planId: 2002, areaPathContains: ["Beta"] },
            ],
          },
          prerequisiteDefaults: {
            personas: {
              Admin: { label: "Admin", profile: "Admin", roles: "Admin", psg: "Admin" },
            },
          },
        },
        null,
        2,
      ),
    );
    process.chdir(fixtureDir);
    __resetConventionsCacheForTests();
  });

  after(() => {
    process.chdir(originalCwd);
    rmSync(fixtureDir, { recursive: true, force: true });
    __resetConventionsCacheForTests();
  });

  // ── buildSprintFolderName ──────────────────────────────────────────

  it("buildSprintFolderName returns prefixed name", () => {
    assert.equal(buildSprintFolderName(12), "S_12");
  });

  it("buildSprintFolderName handles single-digit sprint", () => {
    assert.equal(buildSprintFolderName(1), "S_1");
  });

  // ── buildParentUsFolderName (uses framework default " | " separator) ──

  it("buildParentUsFolderName formats id + separator + title", () => {
    assert.equal(buildParentUsFolderName(1234, "My Feature"), "1234 | My Feature");
  });

  // ── buildUsFolderName ──────────────────────────────────────────────

  it("buildUsFolderName formats id + separator + title", () => {
    assert.equal(buildUsFolderName(5678, "My Story"), "5678 | My Story");
  });

  // ── getNonEpicFolderName (framework default) ───────────────────────

  it("getNonEpicFolderName returns the framework-default value when not overridden", () => {
    assert.equal(getNonEpicFolderName(), "Non-Epic US TCs");
  });

  // ── resolvePlanIdFromAreaPath ──────────────────────────────────────

  it("resolvePlanIdFromAreaPath matches first rule (Alpha → 1001)", () => {
    assert.equal(
      resolvePlanIdFromAreaPath("Project\\Team\\Alpha\\SomeArea"),
      1001,
    );
  });

  it("resolvePlanIdFromAreaPath matches second rule (Beta → 2002)", () => {
    assert.equal(
      resolvePlanIdFromAreaPath("Project\\Team\\Beta\\SomeArea"),
      2002,
    );
  });

  it("resolvePlanIdFromAreaPath is case-insensitive", () => {
    assert.equal(
      resolvePlanIdFromAreaPath("Project\\Team\\alpha\\SomeArea"),
      1001,
    );
  });

  it("resolvePlanIdFromAreaPath throws for unknown path", () => {
    assert.throws(
      () => resolvePlanIdFromAreaPath("Unknown\\Path"),
      (err: Error) => {
        assert.ok(
          err.message.includes("No test plan match"),
          `Expected message to contain "No test plan match", got: ${err.message}`,
        );
        return true;
      },
    );
  });

  // ── resolveSprintFromIteration (uses fixture sprintPrefix "S_") ────

  it("resolveSprintFromIteration extracts sprint number", () => {
    assert.equal(resolveSprintFromIteration("Some\\Path\\S_14"), 14);
  });

  it("resolveSprintFromIteration handles multi-digit sprint", () => {
    assert.equal(resolveSprintFromIteration("Project\\Team\\S_123"), 123);
  });

  it("resolveSprintFromIteration throws when no match", () => {
    assert.throws(
      () => resolveSprintFromIteration("Some\\Path\\NoMatch"),
      (err: Error) => {
        assert.ok(
          err.message.includes("Could not extract sprint"),
          `Expected message to contain "Could not extract sprint", got: ${err.message}`,
        );
        return true;
      },
    );
  });

  // ── buildSuiteQueryString ──────────────────────────────────────────

  it("buildSuiteQueryString contains TC_ prefix and UNDER clause", () => {
    const query = buildSuiteQueryString(12345, "Test Project\\Area");
    assert.ok(
      query.includes("TC_12345"),
      `Expected query to contain "TC_12345", got: ${query}`,
    );
    assert.ok(
      query.includes("UNDER 'Test Project\\Area'"),
      `Expected query to contain UNDER clause, got: ${query}`,
    );
  });

  it("buildSuiteQueryString is valid WIQL structure", () => {
    const query = buildSuiteQueryString(99, "Org\\Project");
    assert.ok(query.startsWith("SELECT [System.Id] FROM WorkItems"));
    assert.ok(query.includes("Microsoft.TestCaseCategory"));
    assert.ok(query.includes("[System.Title] CONTAINS 'TC_99'"));
  });
});
