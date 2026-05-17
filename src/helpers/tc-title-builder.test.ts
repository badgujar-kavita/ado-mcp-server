/**
 * Tests for `buildTcTitle` — title shape with and without the optional
 * `suffix` arg.
 *
 * Goal: lock in the contract that
 *   - canonical (no suffix) titles stay `TC_<usId>_<NN> -> ...`
 *   - suffixed titles embed the resolved CATEGORY tag as
 *     `TC_<usId>_<TAG>_<NN> -> ...`
 *
 * The category tag resolution itself lives in `suffix-tag.ts` and has its own
 * unit-test file. These tests just prove the wiring through `buildTcTitle`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTcTitle } from "./tc-title-builder.ts";
import type { ConventionsConfig } from "../types.ts";

function configFor(): ConventionsConfig {
  // Minimal ConventionsConfig sufficient for buildTcTitle. Mirrors defaults
  // applied by loadConventionsConfig — separator " -> ", numberPadding 2,
  // prefix "TC", maxLength 256.
  return {
    testPlanMapping: [],
    sprintFolderPrefix: "Sprint",
    suiteStructure: {
      tcTitlePrefix: "TC",
      parentUsSeparator: " | ",
    },
    testCaseTitle: {
      prefix: "TC",
      separator: " -> ",
      numberPadding: 2,
      maxLength: 256,
    },
    testCaseDefaults: {
      priority: 2,
      state: "Design",
    },
    prerequisiteDefaults: {
      personas: {},
      personaRolesLabel: "Roles",
      personaPsgLabel: "Permission Set Group",
      testData: "N/A",
    },
  } as unknown as ConventionsConfig;
}

test("buildTcTitle without suffix produces canonical TC_<usId>_<NN> -> ...", () => {
  const title = buildTcTitle(1234, 1, ["Email-to-Case"], "Existing channel still works", configFor());
  assert.equal(title, "TC_1234_01 -> Email-to-Case -> Existing channel still works");
});

test("buildTcTitle without suffix pads number to 2 digits", () => {
  const title = buildTcTitle(1234, 7, ["Routing"], "Tech Support routing fires", configFor());
  assert.match(title, /^TC_1234_07 -> /);
});

test("buildTcTitle with suffix='regression' embeds REG segment", () => {
  const title = buildTcTitle(1234, 1, ["Email-to-Case"], "Existing channel still works", configFor(), "regression");
  assert.equal(title, "TC_1234_REG_01 -> Email-to-Case -> Existing channel still works");
});

test("buildTcTitle with suffix='e2e' embeds E2E segment (digits in tag)", () => {
  const title = buildTcTitle(1234, 1, ["Order"], "Order to Cash", configFor(), "e2e");
  assert.equal(title, "TC_1234_E2E_01 -> Order -> Order to Cash");
});

test("buildTcTitle with suffix='sit' embeds SIT segment", () => {
  const title = buildTcTitle(99, 3, ["External API"], "Integration probe", configFor(), "sit");
  assert.equal(title, "TC_99_SIT_03 -> External API -> Integration probe");
});

test("buildTcTitle with suffix='uat' embeds UAT segment", () => {
  const title = buildTcTitle(42, 1, ["Acceptance"], "Sign-off scenario", configFor(), "uat");
  assert.match(title, /^TC_42_UAT_01 -> /);
});

test("buildTcTitle with suffix='smoke' embeds SMOKE segment", () => {
  const title = buildTcTitle(42, 1, ["Smoke"], "App boots", configFor(), "smoke");
  assert.match(title, /^TC_42_SMOKE_01 -> /);
});

test("buildTcTitle with suffix='performance' embeds PERF segment", () => {
  const title = buildTcTitle(42, 2, ["Load"], "Bulk upload latency", configFor(), "performance");
  assert.match(title, /^TC_42_PERF_02 -> /);
});

test("buildTcTitle with custom suffix derives 5-char uppercase tag", () => {
  // 'accessibility' → ACCES (suffixToTag truncates at 5 chars).
  const title = buildTcTitle(1234, 1, ["A11y"], "Screen reader passes", configFor(), "accessibility");
  assert.match(title, /^TC_1234_ACCES_01 -> /);
});

test("buildTcTitle with undefined suffix matches canonical (no tag)", () => {
  const title = buildTcTitle(1234, 1, ["Feature"], "Summary", configFor(), undefined);
  assert.match(title, /^TC_1234_01 -> /);
  assert.doesNotMatch(title, /TC_1234_[A-Z]+_/, "undefined suffix must NOT inject any tag segment");
});

test("buildTcTitle truncates to maxLength with ellipsis when over the limit", () => {
  const longSummary = "x".repeat(300);
  const title = buildTcTitle(1234, 1, ["Tag"], longSummary, configFor());
  assert.equal(title.length, 256);
  assert.ok(title.endsWith("..."), "long titles should be truncated with ellipsis");
});
