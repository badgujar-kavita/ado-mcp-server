/**
 * Tests that `formatTcDraftToMarkdown` honors the `config` argument so the
 * Common Persona table at the top of every drafted markdown reflects the
 * tenant's `<workspace>/.vortex-ado/config.json` — not whatever the legacy
 * cwd-based `loadConventionsConfig()` happens to find.
 *
 * The whole reason the persona-injection issue surfaced: without an
 * explicit config arg, the formatter's persona row builder defaulted to
 * the cwd loader, which (when MCP is launched by Cursor) resolves to the
 * installer dir and produces a generic placeholder persona. After this
 * fix, callers that pass an explicit config see the personas they passed
 * — full stop.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTcDraftToMarkdown,
  type TcDraftData,
} from "./tc-draft-formatter.ts";
import type { ConventionsConfig } from "../types.ts";

function baseDraft(): TcDraftData {
  return {
    userStoryId: 1234,
    storyTitle: "Sample US",
    storyState: "In Development",
    areaPath: "Project\\Area",
    iterationPath: "Project\\Sprint_1",
    version: 1,
    status: "DRAFT",
    lastUpdated: "2026-05-12",
    testCases: [
      {
        tcNumber: 1,
        featureTags: ["Feature"],
        useCaseSummary: "Verify something",
        priority: 1,
        steps: [{ action: "Do thing", expectedResult: "Thing happens" }],
      },
    ],
  };
}

function configWithPersonas(
  personas: Record<string, { label: string; profile: string; roles: string; psg: string }>,
): ConventionsConfig {
  return {
    testCaseTitle: {
      prefix: "TC",
      separator: " -> ",
      numberPadding: 2,
      template: "{prefix}_{usId}_{tcNumber}{separator}{featureTags}{separator}{summary}",
      maxLength: 256,
    },
    prerequisites: {
      heading: "Prerequisites for Test:",
      sections: [
        { key: "personas", label: "Persona", required: true },
        { key: "preConditions", label: "Pre-requisite", required: true },
        { key: "testData", label: "Test Data", required: false },
      ],
    },
    prerequisiteDefaults: {
      personas,
      personaRolesLabel: "Roles",
      personaPsgLabel: "Permission Set Group",
      commonPreConditions: [],
      toBeTested: null,
      testData: "N/A",
    },
    suiteStructure: {
      sprintPrefix: "Sprint_",
      parentUsSeparator: " | ",
      parentUsTemplate: "{id}{separator}{title}",
      usTemplate: "{id}{separator}{title}",
      nonEpicFolderName: "Non-Epic US TCs",
      tcTitlePrefix: "TC",
    },
    testCaseDefaults: { state: "Design", priority: 2 },
  };
}

test("formatTcDraftToMarkdown: renders persona rows from the explicitly passed config", () => {
  const cfg = configWithPersonas({
    Admin: { label: "Admin", profile: "Admin", roles: "Admin User", psg: "Admin_PSG" },
    SalesRep: {
      label: "Sales Rep",
      profile: "Sales_Rep",
      roles: "Sales_Rep",
      psg: "Sale_Rep_PSG",
    },
  });

  const md = formatTcDraftToMarkdown(baseDraft(), cfg);

  // Both personas show up as rows under the Persona header.
  assert.match(md, /\| Admin \| Admin \| Admin User \| Admin_PSG \|/);
  assert.match(md, /\| Sales Rep \| Sales_Rep \| Sales_Rep \| Sale_Rep_PSG \|/);
  // No leakage of the legacy "System Administrator" placeholder.
  assert.doesNotMatch(md, /System Administrator/);
});

test("formatTcDraftToMarkdown: persona section is OMITTED entirely when config has no personas", () => {
  const cfg = configWithPersonas({});
  const md = formatTcDraftToMarkdown(baseDraft(), cfg);

  // Whole section skipped — no header, no table.
  assert.doesNotMatch(md, /### Persona/);
  assert.doesNotMatch(md, /\| Persona \| Profile \|/);
  // No invented personas either.
  assert.doesNotMatch(md, /System Administrator/);
  assert.doesNotMatch(md, /\| Admin \|/);
});

test("formatTcDraftToMarkdown: respects config personaRolesLabel and personaPsgLabel", () => {
  const cfg = configWithPersonas({
    Foo: { label: "Foo", profile: "Foo", roles: "FooR", psg: "FooG" },
  });
  cfg.prerequisiteDefaults.personaRolesLabel = "TPM Roles";
  cfg.prerequisiteDefaults.personaPsgLabel = "PSG";

  const md = formatTcDraftToMarkdown(baseDraft(), cfg);
  // Header row reflects custom labels.
  assert.match(md, /\| Persona \| Profile \| TPM Roles \| PSG \|/);
});

test("formatTcDraftToMarkdown: persona-row order matches config insertion order", () => {
  const cfg = configWithPersonas({
    Zeta: { label: "Z", profile: "p", roles: "r", psg: "g" },
    Alpha: { label: "A", profile: "p", roles: "r", psg: "g" },
    Mu: { label: "M", profile: "p", roles: "r", psg: "g" },
  });
  const md = formatTcDraftToMarkdown(baseDraft(), cfg);
  const idxZ = md.indexOf("| Z |");
  const idxA = md.indexOf("| A |");
  const idxM = md.indexOf("| M |");
  assert.ok(
    idxZ >= 0 && idxA > idxZ && idxM > idxA,
    `expected Z<A<M, got ${idxZ}/${idxA}/${idxM}`,
  );
});
