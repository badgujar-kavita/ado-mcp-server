/**
 * Merges framework defaults with a per-workspace config to produce the
 * fully-populated ConventionsConfig consumed by tools and helpers.
 *
 * Merge rules (deliberate, audited):
 *
 * - **Field-by-field, deep for objects, shallow for arrays.** Arrays are
 *   REPLACED, not concatenated. If the workspace supplies
 *   `prerequisiteDefaults.personas: {}`, the result is `{}` — the framework
 *   default (which has no personas anyway) is overridden, not merged.
 *
 * - **Workspace value wins on every field.** A workspace that sets
 *   `testCaseTitle.prefix: "TestCase_"` overrides whatever the framework
 *   defines for prefix; all other testCaseTitle fields fall back to
 *   framework values.
 *
 * - **Required Category-1 fields with no framework default propagate as
 *   undefined** when the workspace omits them. Examples: `testCaseTitle.prefix`,
 *   `prerequisiteDefaults.personas`, `suiteStructure.sprintPrefix`,
 *   `suiteStructure.testPlanMapping`. Consumers handle the missing-value case
 *   (typically by surfacing an error to the user via /qa-publish gates).
 *
 * - **Pure function — no I/O, no caching, deterministic.** All caching of
 *   loaded configs lives in the call site (config.ts).
 */

import type { ConventionsConfig } from "../types.ts";
import { defaultsBase, type FrameworkDefaults } from "./defaults.ts";
import type { WorkspaceConfig } from "./schema.ts";

/**
 * Produce the merged ConventionsConfig from framework defaults overlaid
 * with any tenant-supplied workspace config.
 *
 * The result is a complete `ConventionsConfig` shape — every required
 * downstream field is present (or the explicitly-allowed `undefined` for
 * Category-1 fields the tenant must supply).
 */
export function mergeConfig(workspace: WorkspaceConfig): ConventionsConfig {
  const framework = defaultsBase();

  return {
    testCaseTitle: mergeTestCaseTitle(framework, workspace.testCaseTitle),
    prerequisites: mergePrerequisites(framework, workspace.prerequisites),
    prerequisiteDefaults: mergePrerequisiteDefaults(framework, workspace.prerequisiteDefaults),
    suiteStructure: mergeSuiteStructure(framework, workspace.suiteStructure),
    testCaseDefaults: mergeTestCaseDefaults(framework, workspace.testCaseDefaults),
    // prerequisiteFieldRef precedence:
    //   1. workspace.ado.fieldRefs.prerequisite (canonical new location)
    //   2. workspace.prerequisiteFieldRef (legacy top-level)
    //   3. undefined → consumers default to System.Description
    prerequisiteFieldRef:
      workspace.ado?.fieldRefs?.prerequisite ?? workspace.prerequisiteFieldRef,
    solutionDesign: mergeSolutionDesign(framework, workspace),
    additionalContextFields: workspace.additionalContextFields?.map((f) => ({
      adoFieldRef: f.adoFieldRef,
      label: f.label,
      fetchLinks: f.fetchLinks ?? true,
      fetchImages: f.fetchImages ?? true,
    })),
    allFields: mergeAllFields(framework, workspace.allFields),
    images: mergeImages(framework, workspace.images),
    context: mergeContext(framework, workspace.context),
  };
}

// ── Section mergers ────────────────────────────────────────────────────

function mergeTestCaseTitle(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["testCaseTitle"],
): ConventionsConfig["testCaseTitle"] {
  // testCaseTitle.prefix now has a framework default of "TC" — universal
  // convention. Tenants who want a different prefix (e.g. "TestCase")
  // override in their workspace config.
  return {
    prefix: ws?.prefix ?? fw.testCaseTitle.prefix,
    separator: ws?.separator ?? fw.testCaseTitle.separator,
    numberPadding: ws?.numberPadding ?? fw.testCaseTitle.numberPadding,
    template: ws?.template ?? fw.testCaseTitle.template,
    maxLength: ws?.maxLength ?? fw.testCaseTitle.maxLength,
  };
}

function mergePrerequisites(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["prerequisites"],
): ConventionsConfig["prerequisites"] {
  return {
    heading: ws?.heading ?? fw.prerequisites.heading,
    sections: ws?.sections ?? fw.prerequisites.sections,
    preConditionFormat: ws?.preConditionFormat
      ? {
          style: ws.preConditionFormat.style ?? fw.prerequisites.preConditionFormat.style,
          description:
            ws.preConditionFormat.description ?? fw.prerequisites.preConditionFormat.description,
          operators:
            ws.preConditionFormat.operators ?? fw.prerequisites.preConditionFormat.operators,
          examples: ws.preConditionFormat.examples ?? fw.prerequisites.preConditionFormat.examples,
        }
      : fw.prerequisites.preConditionFormat,
  };
}

function mergePrerequisiteDefaults(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["prerequisiteDefaults"],
): ConventionsConfig["prerequisiteDefaults"] {
  return {
    // personas has NO framework default — Category 1. Empty object when
    // workspace doesn't supply, which renders as an empty Persona section.
    personas: ws?.personas ?? {},
    personaRolesLabel: ws?.personaRolesLabel ?? fw.prerequisiteDefaults.personaRolesLabel,
    personaPsgLabel: ws?.personaPsgLabel ?? fw.prerequisiteDefaults.personaPsgLabel,
    commonPreConditions: ws?.commonPreConditions ?? fw.prerequisiteDefaults.commonPreConditions,
    toBeTested: ws?.toBeTested ?? fw.prerequisiteDefaults.toBeTested,
    testData: ws?.testData ?? fw.prerequisiteDefaults.testData,
  };
}

function mergeSuiteStructure(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["suiteStructure"],
): ConventionsConfig["suiteStructure"] {
  return {
    // sprintPrefix has NO framework default — Category 1.
    sprintPrefix: (ws?.sprintPrefix ?? "") as string,
    parentUsSeparator: ws?.parentUsSeparator ?? fw.suiteStructure.parentUsSeparator,
    parentUsTemplate: ws?.parentUsTemplate ?? fw.suiteStructure.parentUsTemplate,
    usTemplate: ws?.usTemplate ?? fw.suiteStructure.usTemplate,
    nonEpicFolderName: ws?.nonEpicFolderName ?? fw.suiteStructure.nonEpicFolderName,
    tcTitlePrefix: ws?.tcTitlePrefix ?? fw.suiteStructure.tcTitlePrefix,
    testPlanMapping: ws?.testPlanMapping,
  };
}

function mergeTestCaseDefaults(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["testCaseDefaults"],
): ConventionsConfig["testCaseDefaults"] {
  return {
    state: ws?.state ?? fw.testCaseDefaults.state,
    priority: ws?.priority ?? fw.testCaseDefaults.priority,
  };
}

function mergeSolutionDesign(
  fw: FrameworkDefaults,
  workspace: WorkspaceConfig,
): ConventionsConfig["solutionDesign"] {
  // solutionDesign.adoFieldRef precedence:
  //   1. workspace.ado.fieldRefs.solutionDesign (canonical new location)
  //   2. workspace.solutionDesign.adoFieldRef (legacy nested)
  //   3. undefined → solutionDesign block is omitted entirely (downstream
  //      consumers treat as "not used")
  const adoFieldRef =
    workspace.ado?.fieldRefs?.solutionDesign ?? workspace.solutionDesign?.adoFieldRef;
  if (!adoFieldRef) return undefined;

  const ws = workspace.solutionDesign;
  return {
    adoFieldRef,
    uiLabel: ws?.uiLabel ?? "Solution Notes",
    usageRules: {
      useFor: ws?.usageRules?.useFor ?? fw.solutionDesign.usageRules.useFor,
      ignore: ws?.usageRules?.ignore ?? fw.solutionDesign.usageRules.ignore,
      adminValidationTemplate:
        ws?.usageRules?.adminValidationTemplate ??
        fw.solutionDesign.usageRules.adminValidationTemplate,
    },
    extractionHints: ws?.extractionHints ?? fw.solutionDesign.extractionHints,
  };
}

function mergeAllFields(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["allFields"],
): ConventionsConfig["allFields"] {
  return {
    passThrough: ws?.passThrough ?? fw.allFields.passThrough,
    omitSystemNoise: ws?.omitSystemNoise ?? fw.allFields.omitSystemNoise,
    omitExtraRefs: ws?.omitExtraRefs ?? fw.allFields.omitExtraRefs,
  };
}

function mergeImages(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["images"],
): ConventionsConfig["images"] {
  return {
    enabled: ws?.enabled ?? fw.images.enabled,
    maxPerUserStory: ws?.maxPerUserStory ?? fw.images.maxPerUserStory,
    maxBytesPerImage: ws?.maxBytesPerImage ?? fw.images.maxBytesPerImage,
    maxTotalBytesPerResponse: ws?.maxTotalBytesPerResponse ?? fw.images.maxTotalBytesPerResponse,
    minBytesToKeep: ws?.minBytesToKeep ?? fw.images.minBytesToKeep,
    downscaleLongSidePx: ws?.downscaleLongSidePx ?? fw.images.downscaleLongSidePx,
    downscaleQuality: ws?.downscaleQuality ?? fw.images.downscaleQuality,
    mimeAllowlist: ws?.mimeAllowlist ?? fw.images.mimeAllowlist,
    inlineSvgAsText: ws?.inlineSvgAsText ?? fw.images.inlineSvgAsText,
    returnMcpImageParts: ws?.returnMcpImageParts ?? fw.images.returnMcpImageParts,
    saveLocally: ws?.saveLocally ?? fw.images.saveLocally,
    savePathTemplate: ws?.savePathTemplate ?? fw.images.savePathTemplate,
  };
}

function mergeContext(
  fw: FrameworkDefaults,
  ws: WorkspaceConfig["context"],
): ConventionsConfig["context"] {
  return {
    maxConfluencePagesPerUserStory:
      ws?.maxConfluencePagesPerUserStory ?? fw.context.maxConfluencePagesPerUserStory,
    maxTotalFetchSeconds: ws?.maxTotalFetchSeconds ?? fw.context.maxTotalFetchSeconds,
  };
}
