import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import type { ConventionsConfig } from "./types.ts";

const PersonaConfigSchema = z.object({
  label: z.string(),
  profile: z.string(),
  user: z.string().optional(),
  tpmRoles: z.string(),
  psg: z.string(),
});

const AdditionalContextFieldSchema = z.object({
  adoFieldRef: z.string(),
  label: z.string(),
  fetchLinks: z.boolean().optional().default(true),
  fetchImages: z.boolean().optional().default(true),
});

const AllFieldsSchema = z.object({
  passThrough: z.boolean().optional().default(true),
  omitSystemNoise: z.boolean().optional().default(true),
  omitExtraRefs: z.array(z.string()).optional().default([]),
});

const ImagesSchema = z.object({
  enabled: z.boolean().optional().default(true),
  maxPerUserStory: z.number().int().positive().optional().default(20),
  maxBytesPerImage: z.number().int().positive().optional().default(2097152),
  maxTotalBytesPerResponse: z.number().int().positive().optional().default(4194304),
  minBytesToKeep: z.number().int().positive().optional().default(4096),
  downscaleLongSidePx: z.number().int().positive().optional().default(1600),
  downscaleQuality: z.number().int().min(1).max(100).optional().default(85),
  mimeAllowlist: z.array(z.string()).optional().default(["image/png", "image/jpeg", "image/gif", "image/svg+xml"]),
  inlineSvgAsText: z.boolean().optional().default(true),
  returnMcpImageParts: z.boolean().optional().default(false),
  saveLocally: z.boolean().optional().default(false),
  savePathTemplate: z.string().optional().default("tc-drafts/US_{usId}/attachments"),
});

const ContextBudgetsSchema = z.object({
  maxConfluencePagesPerUserStory: z.number().int().positive().optional().default(10),
  maxTotalFetchSeconds: z.number().int().positive().optional().default(45),
});

const ConventionsConfigSchema = z.object({
  testCaseTitle: z.object({
    prefix: z.string(),
    separator: z.string(),
    numberPadding: z.number().int().min(1),
    template: z.string(),
    maxLength: z.number().int().min(1).optional(),
  }),
  prerequisites: z.object({
    heading: z.string(),
    sections: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        required: z.boolean(),
      })
    ),
    preConditionFormat: z.object({
      style: z.string(),
      description: z.string(),
      operators: z.array(z.string()),
      examples: z.array(z.string()),
    }).optional(),
  }),
  prerequisiteDefaults: z.object({
    personas: z.record(PersonaConfigSchema),
    commonPreConditions: z.array(z.string()),
    toBeTested: z.union([z.null(), z.array(z.string())]),
    testData: z.string(),
  }),
  suiteStructure: z.object({
    sprintPrefix: z.string(),
    parentUsSeparator: z.string(),
    parentUsTemplate: z.string(),
    usTemplate: z.string(),
    nonEpicFolderName: z.string(),
    testPlanMapping: z.array(z.object({
      planId: z.number().int().positive(),
      areaPathContains: z.union([z.string(), z.array(z.string())]),
    })).optional(),
  }),
  testCaseDefaults: z.object({
    state: z.string(),
    priority: z.number().int().min(1).max(4),
  }),
  prerequisiteFieldRef: z.string().optional(),
  solutionDesign: z.object({
    adoFieldRef: z.string(),
    uiLabel: z.string(),
    usageRules: z.object({
      useFor: z.array(z.string()),
      ignore: z.array(z.string()),
      adminValidationTemplate: z.string(),
    }),
    extractionHints: z.array(z.string()),
  }).optional(),
  additionalContextFields: z.array(AdditionalContextFieldSchema).optional(),
  allFields: AllFieldsSchema.optional(),
  images: ImagesSchema.optional(),
  context: ContextBudgetsSchema.optional(),
});

let _config: ConventionsConfig | null = null;

export function loadConventionsConfig(): ConventionsConfig {
  if (_config) return _config;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(__dirname, "..", "conventions.config.json");
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  _config = ConventionsConfigSchema.parse(parsed) as ConventionsConfig;
  return _config;
}
