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
