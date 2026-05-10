/**
 * Schema for the per-workspace `<workspace>/.vortex-ado/config.json` file.
 *
 * Every field is OPTIONAL at the workspace level — anything the tenant
 * doesn't supply gets filled in from FRAMEWORK_DEFAULTS at merge time.
 * This is what makes a small workspace config like:
 *
 *   {
 *     "version": 1,
 *     "ado": { "url": "...", "org": "...", "project": "..." },
 *     "testCaseTitle": { "prefix": "TC_" }
 *   }
 *
 * a valid, complete config — the merge fills in the rest.
 */

import { z } from "zod";

export const SUPPORTED_CONFIG_VERSION = 1;

const PersonaConfigSchema = z.preprocess(
  (v) => {
    if (v && typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
      // Backward compat: old `tpmRoles` field name still accepted.
      if (!("roles" in obj) && "tpmRoles" in obj) {
        return { ...obj, roles: obj.tpmRoles };
      }
    }
    return v;
  },
  z.object({
    label: z.string(),
    profile: z.string(),
    user: z.string().optional(),
    roles: z.string(),
    psg: z.string(),
  }),
);

const AdditionalContextFieldSchema = z.object({
  adoFieldRef: z.string(),
  label: z.string(),
  fetchLinks: z.boolean().optional(),
  fetchImages: z.boolean().optional(),
});

const PrereqSectionSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
});

/**
 * The on-disk shape of <workspace>/.vortex-ado/config.json.
 *
 * Every block is optional. Tenants supply only what differs from framework
 * defaults. The wizard writes a fully-populated `ado` block on save; other
 * blocks are written only when the wizard or tenant chose non-default values.
 */
export const WorkspaceConfigSchema = z.object({
  version: z.literal(SUPPORTED_CONFIG_VERSION),

  ado: z
    .object({
      url: z.string().url(),
      org: z.string().min(1),
      project: z.string().min(1),
      setupAt: z.string().optional(),
      /**
       * ADO custom field reference names. Discovered by the wizard.
       * - prerequisite: which field stores prereq HTML (e.g. Custom.PrerequisiteforTest;
       *   default System.Description when omitted).
       * - solutionDesign: which field links the Confluence Solution Design page
       *   (e.g. Custom.TechnicalSolution; optional — leave unset if not used).
       */
      fieldRefs: z
        .object({
          prerequisite: z.string().optional(),
          solutionDesign: z.string().optional(),
        })
        .optional(),
    })
    .optional(),

  confluence: z
    .object({
      enabled: z.boolean(),
      url: z.string().url().optional(),
      email: z.string().email().optional(),
    })
    .optional(),

  testCaseTitle: z
    .object({
      prefix: z.string().optional(),
      separator: z.string().optional(),
      numberPadding: z.number().int().min(1).optional(),
      template: z.string().optional(),
      maxLength: z.number().int().min(1).optional(),
    })
    .optional(),

  prerequisites: z
    .object({
      heading: z.string().optional(),
      sections: z.array(PrereqSectionSchema).optional(),
      preConditionFormat: z
        .object({
          style: z.string().optional(),
          description: z.string().optional(),
          operators: z.array(z.string()).optional(),
          examples: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),

  prerequisiteDefaults: z
    .object({
      personas: z.record(PersonaConfigSchema).optional(),
      personaRolesLabel: z.string().optional(),
      personaPsgLabel: z.string().optional(),
      commonPreConditions: z.array(z.string()).optional(),
      toBeTested: z.union([z.null(), z.array(z.string())]).optional(),
      testData: z.string().optional(),
    })
    .optional(),

  suiteStructure: z
    .object({
      sprintPrefix: z.string().optional(),
      parentUsSeparator: z.string().optional(),
      parentUsTemplate: z.string().optional(),
      usTemplate: z.string().optional(),
      nonEpicFolderName: z.string().optional(),
      tcTitlePrefix: z.string().optional(),
      testPlanMapping: z
        .array(
          z.object({
            planId: z.number().int().positive(),
            areaPathContains: z.union([z.string(), z.array(z.string())]),
          }),
        )
        .optional(),
    })
    .optional(),

  testCaseDefaults: z
    .object({
      state: z.string().optional(),
      priority: z.number().int().min(1).max(4).optional(),
    })
    .optional(),

  /**
   * Top-level field ref kept for backward compatibility with the legacy
   * conventions.config.json shape. New configs should use `ado.fieldRefs.prerequisite`.
   * When both are set, `ado.fieldRefs.prerequisite` wins.
   */
  prerequisiteFieldRef: z.string().optional(),

  solutionDesign: z
    .object({
      adoFieldRef: z.string().optional(),
      uiLabel: z.string().optional(),
      usageRules: z
        .object({
          useFor: z.array(z.string()).optional(),
          ignore: z.array(z.string()).optional(),
          adminValidationTemplate: z.string().optional(),
        })
        .optional(),
      extractionHints: z.array(z.string()).optional(),
    })
    .optional(),

  additionalContextFields: z.array(AdditionalContextFieldSchema).optional(),

  allFields: z
    .object({
      passThrough: z.boolean().optional(),
      omitSystemNoise: z.boolean().optional(),
      omitExtraRefs: z.array(z.string()).optional(),
    })
    .optional(),

  images: z
    .object({
      enabled: z.boolean().optional(),
      maxPerUserStory: z.number().int().positive().optional(),
      maxBytesPerImage: z.number().int().positive().optional(),
      maxTotalBytesPerResponse: z.number().int().positive().optional(),
      minBytesToKeep: z.number().int().positive().optional(),
      downscaleLongSidePx: z.number().int().positive().optional(),
      downscaleQuality: z.number().int().min(1).max(100).optional(),
      mimeAllowlist: z.array(z.string()).optional(),
      inlineSvgAsText: z.boolean().optional(),
      returnMcpImageParts: z.boolean().optional(),
      saveLocally: z.boolean().optional(),
      savePathTemplate: z.string().optional(),
    })
    .optional(),

  context: z
    .object({
      maxConfluencePagesPerUserStory: z.number().int().positive().optional(),
      maxTotalFetchSeconds: z.number().int().positive().optional(),
    })
    .optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/**
 * Empty workspace config — represents "tenant supplied no overrides at all".
 * Used as the merge input when no config.json exists in the workspace.
 */
export const EMPTY_WORKSPACE_CONFIG: WorkspaceConfig = {
  version: SUPPORTED_CONFIG_VERSION,
};
