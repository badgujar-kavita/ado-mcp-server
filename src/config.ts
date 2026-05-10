/**
 * Per-workspace conventions config loader.
 *
 * Resolution order:
 *   1. Per-workspace config at `<workspace>/.vortex-ado/config.json`
 *      (workspace = process.cwd(), which Cursor sets to the open folder).
 *      Merged with framework defaults from src/config/defaults.ts.
 *   2. Legacy global config at `~/.vortex-ado/conventions.config.json`.
 *      Read as-is (no merge) for backward compatibility during migration.
 *   3. Framework defaults only (no tenant overrides at all).
 *
 * Multi-project safety: each Cursor window spawns its own MCP process with
 * its own `process.cwd()`, so two windows with two projects open get two
 * different per-workspace configs. They never interfere with each other.
 *
 * The legacy fallback is intentional during Phase 1 of the migration: tenants
 * who haven't yet run /ado-connect in their workspace still see the old
 * behavior. The startup migration warning (Commit 6) tells them what to do.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { z } from "zod";
import type { ConventionsConfig } from "./types.ts";
import { mergeConfig } from "./config/merge.ts";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "./config/schema.ts";

const PersonaConfigSchema = z.preprocess(
  (v) => {
    if (v && typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
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

/**
 * Legacy schema — matches the shipped conventions.config.json shape.
 * Used only when reading the legacy global file during migration.
 */
const LegacyConventionsConfigSchema = z.object({
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
      z.object({ key: z.string(), label: z.string(), required: z.boolean() }),
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
    personaRolesLabel: z.string().optional(),
    personaPsgLabel: z.string().optional(),
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
    tcTitlePrefix: z.string().optional().default("TC"),
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

/** Cache by resolved config source path so each Cursor window's process gets its own copy. */
let _config: ConventionsConfig | null = null;
let _configSource: string | null = null;

/**
 * Path of the per-workspace config file, computed from process.cwd().
 * Each Cursor window's MCP process has its own cwd, so this returns the
 * right per-workspace path automatically.
 */
function workspaceConfigPath(): string {
  return join(process.cwd(), ".vortex-ado", "config.json");
}

/**
 * Path of the legacy global config file.
 */
function legacyConventionsPath(): string {
  return join(homedir(), ".vortex-ado", "conventions.config.json");
}

/**
 * Bundled (shipped) config that lives next to dist/. Kept as a last-resort
 * fallback during Phase 1 — Commit 6 will delete this and rely solely on
 * framework defaults + workspace overrides.
 */
function bundledConventionsPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, "..", "conventions.config.json");
}

/**
 * Load the conventions config for the current workspace.
 *
 * No-arg signature preserved so the ~30 existing callsites don't change.
 * The function reads `process.cwd()` internally to determine the workspace.
 */
export function loadConventionsConfig(): ConventionsConfig {
  if (_config) return _config;

  // Step 1: per-workspace config (canonical new location).
  const wsPath = workspaceConfigPath();
  if (existsSync(wsPath)) {
    try {
      const raw = JSON.parse(readFileSync(wsPath, "utf-8"));
      const workspace = WorkspaceConfigSchema.parse(raw) as WorkspaceConfig;
      _config = mergeConfig(workspace);
      _configSource = wsPath;
      return _config;
    } catch (err) {
      // Surface the schema/parse failure clearly instead of silently falling
      // back to legacy. A malformed workspace config is a user-fixable issue
      // we want to be loud about.
      throw new Error(
        `Failed to parse workspace config at ${wsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Step 2: legacy global config (backward compat during Phase 1).
  const legacyPath = legacyConventionsPath();
  if (existsSync(legacyPath)) {
    const raw = JSON.parse(readFileSync(legacyPath, "utf-8"));
    _config = LegacyConventionsConfigSchema.parse(raw) as ConventionsConfig;
    _configSource = legacyPath;
    return _config;
  }

  // Step 3: bundled shipped config (legacy install fallback). Goes away in Commit 6.
  const bundledPath = bundledConventionsPath();
  if (existsSync(bundledPath)) {
    const raw = JSON.parse(readFileSync(bundledPath, "utf-8"));
    _config = LegacyConventionsConfigSchema.parse(raw) as ConventionsConfig;
    _configSource = bundledPath;
    return _config;
  }

  // Step 4: framework defaults only (truly no tenant config anywhere).
  // Empty workspace config produces a config with empty Category-1 fields
  // (testCaseTitle.prefix=""", personas={}, sprintPrefix="", etc.). Tools
  // surface clear errors when they hit empty Category-1 values.
  _config = mergeConfig({ version: 1 });
  _configSource = "(framework defaults only)";
  return _config;
}

/** Test seam — reset cache so tests can change cwd and reload. */
export function __resetConventionsCacheForTests(): void {
  _config = null;
  _configSource = null;
}

/** Diagnostic — what file (if any) was the loaded config read from? */
export function getConventionsConfigSource(): string | null {
  if (!_config) loadConventionsConfig();
  return _configSource;
}
