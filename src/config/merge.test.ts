/**
 * Exhaustive tests for mergeConfig().
 *
 * Covers:
 *  - Empty workspace config → all framework defaults flow through
 *  - Partial workspace config → specified fields override, rest fall back
 *  - Full workspace config → workspace wins everywhere
 *  - Arrays are REPLACED, not concatenated
 *  - Category-1 fields with no framework default propagate as empty/undefined
 *  - Legacy field name precedence (ado.fieldRefs vs top-level)
 *  - solutionDesign block emerges only when adoFieldRef is supplied
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig } from "./merge.ts";
import { EMPTY_WORKSPACE_CONFIG, type WorkspaceConfig } from "./schema.ts";

// ── Empty workspace → framework defaults flow through ────────────────────

test("mergeConfig: empty workspace yields full framework defaults", () => {
  const merged = mergeConfig(EMPTY_WORKSPACE_CONFIG);
  // Universal defaults survive verbatim.
  assert.equal(merged.testCaseTitle.separator, " -> ");
  assert.equal(merged.testCaseTitle.numberPadding, 2);
  assert.equal(merged.testCaseTitle.maxLength, 256);
  assert.equal(merged.prerequisites.heading, "Prerequisites for Test:");
  assert.equal(merged.prerequisites.sections.length, 3);
  assert.equal(merged.prerequisites.sections[0].key, "personas");
  assert.equal(merged.prerequisiteDefaults.personaRolesLabel, "Roles");
  assert.equal(merged.prerequisiteDefaults.personaPsgLabel, "Permission Set Group");
  assert.equal(merged.prerequisiteDefaults.testData, "N/A");
  assert.equal(merged.suiteStructure.parentUsSeparator, " | ");
  assert.equal(merged.suiteStructure.nonEpicFolderName, "Non-Epic US TCs");
  assert.equal(merged.suiteStructure.tcTitlePrefix, "TC");
  assert.equal(merged.testCaseDefaults.state, "Design");
  assert.equal(merged.testCaseDefaults.priority, 2);
  assert.equal(merged.allFields?.passThrough, true);
  assert.equal(merged.images?.enabled, false);
  assert.equal(merged.images?.maxPerUserStory, 20);
  assert.equal(merged.context?.maxConfluencePagesPerUserStory, 10);
});

test("mergeConfig: empty workspace leaves Category-1 fields empty", () => {
  const merged = mergeConfig(EMPTY_WORKSPACE_CONFIG);
  // Category 1 fields must NOT have framework defaults — tenant must supply.
  assert.equal(merged.testCaseTitle.prefix, "");
  assert.deepEqual(merged.prerequisiteDefaults.personas, {});
  assert.equal(merged.suiteStructure.sprintPrefix, "");
  assert.equal(merged.suiteStructure.testPlanMapping, undefined);
  assert.equal(merged.solutionDesign, undefined);
  assert.equal(merged.prerequisiteFieldRef, undefined);
  assert.equal(merged.additionalContextFields, undefined);
});

// ── Partial workspace → specified fields override ────────────────────────

test("mergeConfig: testCaseTitle.prefix override flows through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    testCaseTitle: { prefix: "TestCase_" },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.testCaseTitle.prefix, "TestCase_");
  // Other testCaseTitle fields fall back to framework.
  assert.equal(merged.testCaseTitle.separator, " -> ");
  assert.equal(merged.testCaseTitle.numberPadding, 2);
});

test("mergeConfig: personas override flows through verbatim", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisiteDefaults: {
      personas: {
        Cashier: {
          label: "Cashier",
          profile: "POS_Profile",
          roles: "Cashier",
          psg: "POS Users PSG",
        },
      },
    },
  };
  const merged = mergeConfig(ws);
  assert.equal(Object.keys(merged.prerequisiteDefaults.personas).length, 1);
  assert.equal(merged.prerequisiteDefaults.personas.Cashier.label, "Cashier");
  assert.equal(merged.prerequisiteDefaults.personas.Cashier.profile, "POS_Profile");
});

test("mergeConfig: persona labels override flow through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisiteDefaults: {
      personaRolesLabel: "TPM Roles",
      personaPsgLabel: "PSG",
    },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.prerequisiteDefaults.personaRolesLabel, "TPM Roles");
  assert.equal(merged.prerequisiteDefaults.personaPsgLabel, "PSG");
});

test("mergeConfig: sprintPrefix override + testPlanMapping passes through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    suiteStructure: {
      sprintPrefix: "SFTPM_",
      testPlanMapping: [
        { planId: 1066479, areaPathContains: ["DHub", "D-HUB"] },
        { planId: 1066480, areaPathContains: ["EHub", "E-HUB"] },
      ],
    },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.suiteStructure.sprintPrefix, "SFTPM_");
  assert.equal(merged.suiteStructure.testPlanMapping?.length, 2);
  assert.equal(merged.suiteStructure.testPlanMapping?.[0].planId, 1066479);
  // Other suiteStructure fields fall back to framework.
  assert.equal(merged.suiteStructure.parentUsSeparator, " | ");
  assert.equal(merged.suiteStructure.nonEpicFolderName, "Non-Epic US TCs");
});

// ── Arrays are REPLACED, not concatenated ────────────────────────────────

test("mergeConfig: arrays are replaced, not merged", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisites: {
      preConditionFormat: {
        examples: ["Custom example A", "Custom example B"],
      },
    },
  };
  const merged = mergeConfig(ws);
  // Workspace examples completely replace framework examples.
  assert.deepEqual(merged.prerequisites.preConditionFormat?.examples, [
    "Custom example A",
    "Custom example B",
  ]);
});

test("mergeConfig: workspace personas replace framework (not merge with)", () => {
  // Framework has no personas, but tenant override should be the SOLE source.
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisiteDefaults: {
      personas: {
        OnlyPersona: {
          label: "Only Persona",
          profile: "Only_Profile",
          roles: "Solo",
          psg: "Solo PSG",
        },
      },
    },
  };
  const merged = mergeConfig(ws);
  assert.deepEqual(Object.keys(merged.prerequisiteDefaults.personas), ["OnlyPersona"]);
});

test("mergeConfig: empty personas object overrides defaults explicitly", () => {
  // Tenant explicitly sets `personas: {}` — should yield empty, not framework default
  // (framework has no default personas anyway, but the contract is "workspace wins").
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisiteDefaults: { personas: {} },
  };
  const merged = mergeConfig(ws);
  assert.deepEqual(merged.prerequisiteDefaults.personas, {});
});

// ── Legacy fieldRef precedence ───────────────────────────────────────────

test("mergeConfig: ado.fieldRefs.prerequisite wins over legacy top-level prerequisiteFieldRef", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisiteFieldRef: "Custom.OldFieldRef",
    ado: {
      url: "https://dev.azure.com/myorg",
      org: "myorg",
      project: "p",
      fieldRefs: { prerequisite: "Custom.NewFieldRef" },
    },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.prerequisiteFieldRef, "Custom.NewFieldRef");
});

test("mergeConfig: legacy top-level prerequisiteFieldRef still works alone", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    prerequisiteFieldRef: "Custom.PrerequisiteforTest",
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.prerequisiteFieldRef, "Custom.PrerequisiteforTest");
});

test("mergeConfig: no fieldRef supplied → undefined (consumer falls back)", () => {
  const merged = mergeConfig(EMPTY_WORKSPACE_CONFIG);
  assert.equal(merged.prerequisiteFieldRef, undefined);
});

// ── solutionDesign block emerges only when configured ────────────────────

test("mergeConfig: solutionDesign undefined when no adoFieldRef supplied", () => {
  const merged = mergeConfig(EMPTY_WORKSPACE_CONFIG);
  assert.equal(merged.solutionDesign, undefined);
});

test("mergeConfig: solutionDesign emerges when ado.fieldRefs.solutionDesign is set", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    ado: {
      url: "https://dev.azure.com/myorg",
      org: "myorg",
      project: "p",
      fieldRefs: { solutionDesign: "Custom.TechnicalSolution" },
    },
  };
  const merged = mergeConfig(ws);
  assert.ok(merged.solutionDesign);
  assert.equal(merged.solutionDesign?.adoFieldRef, "Custom.TechnicalSolution");
  // Default uiLabel applies.
  assert.equal(merged.solutionDesign?.uiLabel, "Solution Notes");
  // Framework usageRules + extractionHints flow in.
  assert.ok(merged.solutionDesign?.usageRules.useFor.length! > 0);
  assert.ok(merged.solutionDesign?.extractionHints.length! > 0);
});

test("mergeConfig: solutionDesign legacy nested adoFieldRef still works", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    solutionDesign: { adoFieldRef: "Custom.TechSpec" },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.solutionDesign?.adoFieldRef, "Custom.TechSpec");
});

test("mergeConfig: solutionDesign uiLabel + usageRules override flow through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    ado: {
      url: "https://dev.azure.com/myorg",
      org: "myorg",
      project: "p",
      fieldRefs: { solutionDesign: "Custom.X" },
    },
    solutionDesign: {
      uiLabel: "Tech Spec",
      usageRules: { useFor: ["Custom rule 1"], ignore: ["Custom ignore"] },
    },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.solutionDesign?.uiLabel, "Tech Spec");
  assert.deepEqual(merged.solutionDesign?.usageRules.useFor, ["Custom rule 1"]);
  assert.deepEqual(merged.solutionDesign?.usageRules.ignore, ["Custom ignore"]);
  // adminValidationTemplate falls back to framework.
  assert.match(
    merged.solutionDesign?.usageRules.adminValidationTemplate ?? "",
    /System Administrator/,
  );
});

// ── additionalContextFields default flags ────────────────────────────────

test("mergeConfig: additionalContextFields default fetchLinks/fetchImages to true", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    additionalContextFields: [{ adoFieldRef: "Custom.X", label: "X" }],
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.additionalContextFields?.[0].fetchLinks, true);
  assert.equal(merged.additionalContextFields?.[0].fetchImages, true);
});

test("mergeConfig: additionalContextFields fetchLinks/fetchImages explicit false respected", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    additionalContextFields: [
      { adoFieldRef: "Custom.X", label: "X", fetchLinks: false, fetchImages: false },
    ],
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.additionalContextFields?.[0].fetchLinks, false);
  assert.equal(merged.additionalContextFields?.[0].fetchImages, false);
});

// ── Image and context budget overrides ───────────────────────────────────

test("mergeConfig: image budget override flows through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    images: { maxPerUserStory: 5, downscaleQuality: 60 },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.images?.maxPerUserStory, 5);
  assert.equal(merged.images?.downscaleQuality, 60);
  // Other image fields fall back to framework.
  assert.equal(merged.images?.maxBytesPerImage, 2_097_152);
  assert.equal(merged.images?.enabled, false);
});

test("mergeConfig: images.enabled tenant override (true) wins over framework default (false)", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    images: { enabled: true },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.images?.enabled, true);
});

test("mergeConfig: context budget override flows through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    context: { maxConfluencePagesPerUserStory: 3 },
  };
  const merged = mergeConfig(ws);
  assert.equal(merged.context?.maxConfluencePagesPerUserStory, 3);
  assert.equal(merged.context?.maxTotalFetchSeconds, 45);
});

// ── allFields override ───────────────────────────────────────────────────

test("mergeConfig: allFields.omitExtraRefs override flows through", () => {
  const ws: WorkspaceConfig = {
    version: 1,
    allFields: { omitExtraRefs: ["Custom.NoiseField"] },
  };
  const merged = mergeConfig(ws);
  assert.deepEqual(merged.allFields?.omitExtraRefs, ["Custom.NoiseField"]);
  assert.equal(merged.allFields?.passThrough, true);
});

// ── Mutation safety ──────────────────────────────────────────────────────

test("mergeConfig: defaultsBase returns fresh copies (mutating result doesn't pollute next call)", () => {
  const merged1 = mergeConfig(EMPTY_WORKSPACE_CONFIG);
  // Mutate.
  merged1.prerequisites.sections.push({ key: "fake", label: "Fake", required: false });
  merged1.images!.maxPerUserStory = 999;

  // Next call should be unaffected.
  const merged2 = mergeConfig(EMPTY_WORKSPACE_CONFIG);
  assert.equal(merged2.prerequisites.sections.length, 3);
  assert.equal(merged2.images?.maxPerUserStory, 20);
});
