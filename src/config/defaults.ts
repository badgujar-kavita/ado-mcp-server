/**
 * Framework defaults for ConventionsConfig.
 *
 * These values are universal across all projects/tenants. They never go in
 * the per-workspace config.json and tenants don't see them unless they
 * explicitly override a field.
 *
 * The merge order at runtime is:
 *   1. FRAMEWORK_DEFAULTS (this file)
 *   2. <workspace>/.vortex-ado/config.json (tenant-supplied)
 *   3. Result is the merged ConventionsConfig consumed by tools/helpers.
 *
 * Per the design doc, fields are categorized:
 *
 * - Category 1 (must be per-project): testCaseTitle.prefix, personas, plan
 *   mappings, sprintPrefix, prereq field ref, etc. → live ONLY in workspace
 *   config; this file does not provide defaults that would mask a missing
 *   value.
 * - Category 2 (universal defaults): heading text, prereq sections ordering,
 *   image budgets, context budgets, etc. → live HERE.
 * - Category 3 (dead/legacy): commonPreConditions, toBeTested → preserved
 *   in the schema as deprecated until follow-up cleanup.
 *
 * Anything that is genuinely team-specific (e.g. KAM persona, DHub plan ID)
 * MUST NOT be added here. This file is shipped to all tenants verbatim.
 */

import type { ConventionsConfig } from "../types.ts";

/**
 * The shape returned by `defaultsBase()`. We deliberately use a permissive
 * partial to make merge logic straightforward: tenant overrides win
 * field-by-field, framework values fill the gaps.
 */
export type FrameworkDefaults = {
  testCaseTitle: {
    separator: string;
    numberPadding: number;
    template: string;
    maxLength: number;
  };
  prerequisites: {
    heading: string;
    sections: ConventionsConfig["prerequisites"]["sections"];
    preConditionFormat: NonNullable<ConventionsConfig["prerequisites"]["preConditionFormat"]>;
  };
  prerequisiteDefaults: {
    personaRolesLabel: string;
    personaPsgLabel: string;
    commonPreConditions: string[];
    toBeTested: null;
    testData: string;
  };
  suiteStructure: {
    parentUsSeparator: string;
    parentUsTemplate: string;
    usTemplate: string;
    nonEpicFolderName: string;
    tcTitlePrefix: string;
  };
  testCaseDefaults: {
    state: string;
    priority: number;
  };
  solutionDesign: {
    usageRules: NonNullable<ConventionsConfig["solutionDesign"]>["usageRules"];
    extractionHints: string[];
  };
  allFields: {
    passThrough: boolean;
    omitSystemNoise: boolean;
    omitExtraRefs: string[];
  };
  images: NonNullable<ConventionsConfig["images"]>;
  context: NonNullable<ConventionsConfig["context"]>;
};

/**
 * Returns a fresh copy of the framework defaults. Always returns a NEW
 * object so merge logic can mutate freely without polluting the source.
 */
export function defaultsBase(): FrameworkDefaults {
  return structuredClone(FRAMEWORK_DEFAULTS);
}

/**
 * Single source of truth for framework defaults. Do not mutate.
 *
 * Field selection rationale (audited per the design doc, 2026-05-10):
 * - Hardcoded ONLY universal values; nothing project-specific.
 * - testCaseTitle.prefix is OMITTED — must come from workspace config.
 * - prerequisiteDefaults.personas is OMITTED — must come from workspace config.
 * - suiteStructure.sprintPrefix is OMITTED — must come from workspace config.
 * - suiteStructure.testPlanMapping is OMITTED — must come from workspace config.
 * - solutionDesign.adoFieldRef + uiLabel are OMITTED — must come from workspace config.
 * - prerequisiteFieldRef has no framework default — falls back to "System.Description"
 *   at consumer level (test-cases.ts) when missing.
 */
const FRAMEWORK_DEFAULTS: FrameworkDefaults = {
  testCaseTitle: {
    separator: " -> ",
    numberPadding: 2,
    template: "{prefix}{usId}_{tcNumber}{separator}{featureTags}{separator}{summary}",
    maxLength: 256,
  },

  prerequisites: {
    heading: "Prerequisites for Test:",
    sections: [
      { key: "personas", label: "Persona", required: true },
      { key: "preConditions", label: "Pre-requisite", required: true },
      { key: "testData", label: "Test Data", required: false },
    ],
    preConditionFormat: {
      style: "technical",
      description:
        "Prefer Object.Field = Value for config/field conditions. Use narrative when " +
        "describing scenario setup (e.g. 'Entity without X config', 'Record for which " +
        "no mapping exists'). Use [Config should be setup/available] or [Config should " +
        "be setup] as optional bracket hints.",
      operators: [
        "=",
        "!=",
        "!= NULL",
        "= NULL",
        "= TRUE",
        "= FALSE",
        ">",
        "<",
        ">=",
        "<=",
        "IN",
        "NOT IN",
        "CONTAINS",
        "OR",
      ],
      examples: [
        "Object.Field = Value",
        "Object.Field__c != NULL",
        "CustomLabel = Value",
        "CustomMetadataType.Field = Value",
        "CustomSetting.Field = Value",
        "Workflow State Transition Action [State A -> State B] => [Config should be setup]",
      ],
    },
  },

  prerequisiteDefaults: {
    personaRolesLabel: "Roles",
    personaPsgLabel: "Permission Set Group",
    commonPreConditions: [], // Deprecated; preserved for schema compatibility.
    toBeTested: null, // Deprecated; preserved for schema compatibility.
    testData: "N/A",
  },

  suiteStructure: {
    parentUsSeparator: " | ",
    parentUsTemplate: "{id}{separator}{title}",
    usTemplate: "{id}{separator}{title}",
    nonEpicFolderName: "Non-Epic US TCs",
    tcTitlePrefix: "TC",
  },

  testCaseDefaults: {
    state: "Design",
    priority: 2,
  },

  solutionDesign: {
    usageRules: {
      useFor: [
        "Business process and functionality context",
        "New fields (Object.Field__c) introduced in the solution",
        "New configurations, settings, or feature flags",
        "Pre-requisite conditions in technical format",
        "Admin validation: verify fields/settings accessible to System Administrator",
      ],
      ignore: [
        "Code snippets, Apex, JavaScript, LWC, triggers",
        "Implementation or deployment details",
        "Test steps (belong in Steps section)",
      ],
      adminValidationTemplate:
        "Verify {fieldOrSetting} is accessible and present in the system for System Administrator",
    },
    extractionHints: [
      "Look for: New custom fields (__c suffix), new picklist values, new page layouts, new Lightning actions",
      "Look for: Configuration tables, setup requirements, permission/PSG changes",
      "Output pre-requisites as: Object.Field = Value (see preConditionFormat)",
    ],
  },

  allFields: {
    passThrough: true,
    omitSystemNoise: true,
    omitExtraRefs: [],
  },

  images: {
    enabled: true,
    maxPerUserStory: 20,
    maxBytesPerImage: 2_097_152,
    maxTotalBytesPerResponse: 4_194_304,
    minBytesToKeep: 4096,
    downscaleLongSidePx: 1600,
    downscaleQuality: 85,
    mimeAllowlist: ["image/png", "image/jpeg", "image/gif", "image/svg+xml"],
    inlineSvgAsText: true,
    returnMcpImageParts: false,
    saveLocally: false,
    savePathTemplate: "tc-drafts/US_{usId}/attachments",
  },

  context: {
    maxConfluencePagesPerUserStory: 10,
    maxTotalFetchSeconds: 45,
  },
};
