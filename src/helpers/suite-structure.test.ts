/**
 * Unit tests for the pure helper functions in src/helpers/suite-structure.ts.
 *
 * These tests use the real conventions.config.json checked into the repo.
 * The config drives the expected values (e.g. sprintPrefix "SFTPM_",
 * parentUsSeparator " | ", testPlanMapping entries).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSprintFolderName,
  buildParentUsFolderName,
  buildUsFolderName,
  getNonEpicFolderName,
  resolvePlanIdFromAreaPath,
  resolveSprintFromIteration,
  buildSuiteQueryString,
} from "../helpers/suite-structure.ts";

describe("suite-structure helpers", () => {
  // ── buildSprintFolderName ─────────────────────────────────────────

  it("buildSprintFolderName returns prefixed name", () => {
    assert.equal(buildSprintFolderName(12), "SFTPM_12");
  });

  it("buildSprintFolderName handles single-digit sprint", () => {
    assert.equal(buildSprintFolderName(1), "SFTPM_1");
  });

  // ── buildParentUsFolderName ───────────────────────────────────────

  it("buildParentUsFolderName formats id + separator + title", () => {
    assert.equal(
      buildParentUsFolderName(1234, "My Feature"),
      "1234 | My Feature",
    );
  });

  // ── buildUsFolderName ─────────────────────────────────────────────

  it("buildUsFolderName formats id + separator + title", () => {
    assert.equal(buildUsFolderName(5678, "My Story"), "5678 | My Story");
  });

  // ── getNonEpicFolderName ──────────────────────────────────────────

  it("getNonEpicFolderName returns configured value", () => {
    assert.equal(getNonEpicFolderName(), "Non-Epic US TCs");
  });

  // ── resolvePlanIdFromAreaPath ─────────────────────────────────────

  it("resolvePlanIdFromAreaPath matches DHub area path", () => {
    assert.equal(
      resolvePlanIdFromAreaPath("Project\\Team\\DHub\\SomeArea"),
      1066479,
    );
  });

  it("resolvePlanIdFromAreaPath matches EHub area path", () => {
    assert.equal(
      resolvePlanIdFromAreaPath("Project\\Team\\EHub\\SomeArea"),
      1066480,
    );
  });

  it("resolvePlanIdFromAreaPath is case-insensitive", () => {
    assert.equal(
      resolvePlanIdFromAreaPath("Project\\Team\\dhub\\SomeArea"),
      1066479,
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

  // ── resolveSprintFromIteration ────────────────────────────────────

  it("resolveSprintFromIteration extracts sprint number", () => {
    assert.equal(
      resolveSprintFromIteration("Some\\Path\\SFTPM_14"),
      14,
    );
  });

  it("resolveSprintFromIteration handles multi-digit sprint", () => {
    assert.equal(
      resolveSprintFromIteration("Project\\Team\\SFTPM_123"),
      123,
    );
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

  // ── buildSuiteQueryString ─────────────────────────────────────────

  it("buildSuiteQueryString contains TC_ prefix and UNDER clause", () => {
    const query = buildSuiteQueryString(12345, "TPM Product\\Area");
    assert.ok(
      query.includes("TC_12345"),
      `Expected query to contain "TC_12345", got: ${query}`,
    );
    assert.ok(
      query.includes("UNDER 'TPM Product\\Area'"),
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
