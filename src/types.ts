// ── Azure DevOps Work Item Types ──

export interface AdoWorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: AdoRelation[];
  url: string;
}

export interface AdoRelation {
  rel: string;
  url: string;
  attributes: Record<string, unknown>;
}

export interface UserStoryContext {
  id: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  areaPath: string;
  iterationPath: string;
  state: string;
  parentId: number | null;
  parentTitle: string | null;
  relations: AdoRelation[];
  namedFields?: Record<string, { label: string; html: string; plainText: string }>;
  allFields?: Record<string, unknown>;
  fetchedConfluencePages?: FetchedConfluencePage[];
  unfetchedLinks?: UnfetchedLink[];
  embeddedImages?: EmbeddedImage[];
  /**
   * Present when `ado_story` discovered Confluence links across two or more
   * distinct ADO fields and the caller didn't pre-select which to fetch.
   * When present, `fetchedConfluencePages` is `[]` and the agent should
   * relay the candidates to the user, then re-call `ado_story` with
   * `confluencePageUrls` populated.
   */
  pendingDecision?: ConfluenceMultiFieldDecision;
  /** @deprecated Use namedFields / fetchedConfluencePages instead. */
  solutionDesignUrl: string | null;
  /** @deprecated Use namedFields / fetchedConfluencePages instead. */
  solutionDesignContent: string | null;
}

// ── Test Plan Types ──

export interface AdoTestPlan {
  id: number;
  name: string;
  areaPath: string;
  iteration: string;
  rootSuite: { id: number; name: string };
  state: string;
  revision: number;
}

export interface AdoTestPlanListResponse {
  value: AdoTestPlan[];
  count: number;
}

// ── Test Suite Types ──

export type SuiteType = "staticTestSuite" | "dynamicTestSuite" | "requirementTestSuite";

export interface AdoTestSuite {
  id: number;
  name: string;
  suiteType: SuiteType;
  parentSuite?: { id: number; name: string };
  plan: { id: number; name: string };
  queryString?: string;
  revision: number;
  hasChildren: boolean;
}

export interface AdoTestSuiteListResponse {
  value: AdoTestSuite[];
  count: number;
}

export interface SuiteHierarchyResult {
  planId: number;
  leafSuiteId: number;
  leafSuiteName: string;
  created: string[];
  existing: string[];
  warnings?: string[];
}

// ── Test Case Types ──

export interface TestStep {
  action: string;
  expectedResult: string;
}

export interface PrereqTable {
  /** Column headers from the Markdown table header row. */
  headers: string[];
  /** Data rows, one array per row; cells are raw (non-HTML-escaped) text. */
  rows: string[][];
}

/**
 * Pre-requisite row with optional child marker. When `isChild: true`, the row
 * was authored as a nested bullet (`- ...` or `• ...`) under the previous
 * non-child row in the source markdown table. Drives proper `<ol><li>...<ul><li>`
 * nesting in the ADO HTML output instead of broken sibling-list rendering.
 */
export interface PrereqHierarchyRow {
  text: string;
  isChild: boolean;
}

export interface Prerequisites {
  personas?: string | string[] | null;
  preConditions?: string[] | null;
  /**
   * Hierarchical pre-requisite list capturing parent/child relationships.
   * When present AND any row has `isChild: true`, the HTML builder emits
   * properly nested `<ol><li>...<ul><li>...</li></ul></li></ol>`. Otherwise
   * the builder falls back to the flat `preConditions[]` (existing behavior).
   */
  preConditionsHierarchy?: PrereqHierarchyRow[] | null;
  /**
   * Multi-column structured Pre-requisite table. When present AND has more than
   * 2 columns, the HTML builder emits a real `<table>` instead of a flat `<ol>`.
   * The flat `preConditions[]` should still be populated for backward compat.
   */
  preConditionsTable?: PrereqTable | null;
  testData?: string | null;
  /**
   * Multi-row structured Test Data table. When present AND has at least 1 data row,
   * the HTML builder emits a real `<table>` in ADO and the markdown formatter writes
   * a proper multi-line table in the draft. Mirrors `preConditionsTable` semantics.
   */
  testDataTable?: PrereqTable | null;
}

export interface CreateTestCaseInput {
  planId: number;
  userStoryId: number;
  tcNumber?: number;
  featureTags: string[];
  useCaseSummary: string;
  priority?: number;
  prerequisites?: Prerequisites;
  steps: TestStep[];
  areaPath?: string | null;
  iterationPath?: string | null;
  assignedTo?: string;
}

export interface TestCaseResult {
  id: number;
  title: string;
  url: string;
  state: string;
  priority: number;
}

// ── JSON Patch Types (for ADO work item API) ──

export interface JsonPatchOperation {
  op: "add" | "replace" | "remove" | "test";
  path: string;
  value?: unknown;
}

// ── Conventions Config Types ──

export interface PersonaConfig {
  label: string;
  profile: string;
  user?: string;
  /**
   * Project-specific role identifier for the persona (e.g. "KAM", "ADMIN",
   * "Manager"). Rendered under the persona's `personaRolesLabel` (default
   * "Roles", configurable in `prerequisiteDefaults.personaRolesLabel`).
   */
  roles: string;
  /**
   * Identifier for the Permission Set Group (or equivalent record-access
   * construct — Permission Set, Public Group, Role, etc.) assigned to the
   * persona. The DISPLAY label rendered next to this value is controlled by
   * `personaPsgLabel` in `prerequisiteDefaults` (default "Permission Set
   * Group"), so teams using a different construct can relabel without
   * renaming this field.
   */
  psg: string;
}

export interface PrerequisiteSection {
  key: string;
  label: string;
  required: boolean;
}

export interface ConventionsConfig {
  testCaseTitle: {
    prefix: string;
    separator: string;
    numberPadding: number;
    template: string;
    maxLength?: number;
  };
  prerequisites: {
    heading: string;
    sections: PrerequisiteSection[];
    preConditionFormat?: {
      style: string;
      description: string;
      operators: string[];
      examples: string[];
    };
  };
  prerequisiteDefaults: {
    personas: Record<string, PersonaConfig>;
    /**
     * Label displayed next to `PersonaConfig.roles` in generated test cases
     * and draft markdown. Defaults to "Roles" when omitted. Teams using
     * project-specific terminology (e.g. "TPM Roles", "Okta Groups") set this
     * to whatever reads naturally for their domain.
     */
    personaRolesLabel?: string;
    /**
     * Label displayed next to `PersonaConfig.psg` in generated test cases
     * and draft markdown. Defaults to "Permission Set Group" when omitted.
     * Teams using an abbreviation (e.g. "PSG") or a different construct
     * (e.g. "Permission Set" if they're not using groups) set this
     * explicitly.
     */
    personaPsgLabel?: string;
    commonPreConditions: string[];
    toBeTested: null | string[];
    testData: string;
  };
  suiteStructure: {
    sprintPrefix: string;
    parentUsSeparator: string;
    parentUsTemplate: string;
    usTemplate: string;
    nonEpicFolderName: string;
    /** Prefix used in WIQL query for query-based suites (default "TC"). */
    tcTitlePrefix?: string;
    /** Map AreaPath to test plan ID. First match wins. */
    testPlanMapping?: Array<{ planId: number; areaPathContains: string | string[] }>;
  };
  testCaseDefaults: {
    state: string;
    priority: number;
  };
  prerequisiteFieldRef?: string;
  solutionDesign?: SolutionDesignUsage;
  additionalContextFields?: Array<{
    adoFieldRef: string;
    label: string;
    fetchLinks?: boolean;
    fetchImages?: boolean;
  }>;
  allFields?: {
    passThrough?: boolean;
    omitSystemNoise?: boolean;
    omitExtraRefs?: string[];
  };
  images?: {
    enabled?: boolean;
    maxPerUserStory?: number;
    maxBytesPerImage?: number;
    maxTotalBytesPerResponse?: number;
    minBytesToKeep?: number;
    downscaleLongSidePx?: number;
    downscaleQuality?: number;
    mimeAllowlist?: string[];
    inlineSvgAsText?: boolean;
    returnMcpImageParts?: boolean;
    saveLocally?: boolean;
    savePathTemplate?: string;
  };
  context?: {
    maxConfluencePagesPerUserStory?: number;
    maxTotalFetchSeconds?: number;
  };
}

export interface SolutionDesignUsage {
  adoFieldRef: string;
  uiLabel: string;
  usageRules: {
    useFor: string[];
    ignore: string[];
    adminValidationTemplate: string;
  };
  extractionHints: string[];
}

// ── Confluence Types ──

export interface ConfluencePageResult {
  title: string;
  body: string;
}

export interface ConfluencePageResultRaw extends ConfluencePageResult {
  rawStorageHtml: string;
}

export interface ConfluenceAttachmentListItem {
  id: string;
  title: string;
  mediaType: string;
  fileSize?: number;
  version: { number: number };
  downloadUrl: string;  // may be relative (/wiki/download/...) — caller joins against baseUrl
}

export interface ConfluenceBinaryResponse {
  buffer: ArrayBuffer;
  mimeType: string | null;
}

// ── All-Fields / Embedded Images / External Links Types ──

export type ExternalLinkType =
  | "Confluence" | "SharePoint" | "Figma" | "LucidChart" | "GoogleDrive" | "Other";

export interface CategorizedLink {
  url: string;
  type: ExternalLinkType;
  pageId?: string;
  sourceField: string;
}

export interface EmbeddedImage {
  source: "ado" | "confluence";
  sourceField?: string;
  sourcePageId?: string;
  originalUrl: string;
  filename: string;
  mimeType: string;
  bytes: number;
  originalBytes?: number;
  downscaled?: boolean;
  altText?: string;
  svgInlineText?: string;
  localPath?: string;
  relativeToDraft?: string;
  skipped?: "too-small" | "too-large" | "unsupported-mime" | "fetch-failed" | "response-budget" | "time-budget";
  /** @internal Raw image bytes held in memory between fetch and response packing. Not serialized to JSON. */
  _buffer?: ArrayBuffer;
}

export interface FetchedConfluencePage {
  pageId: string;
  title: string;
  url: string;
  body: string;
  sourceField: string;
  images: EmbeddedImage[];
}

export interface UnfetchedLink {
  url: string;
  type: ExternalLinkType;
  sourceField: string;
  reason: "cross-instance" | "non-confluence" | "access-denied" | "not-found" | "auth-failure" | "link-budget" | "time-budget";
  workaround: string;
}

/**
 * One Confluence page candidate surfaced when `ado_story` finds Confluence
 * links across two or more distinct ADO fields and the caller didn't
 * pre-select which to fetch via `confluencePageUrls`.
 *
 * Includes a peeked `title` (one cheap title-only fetch per candidate) so the
 * end-user can pick by name, not by opaque tiny-URL token. `pageId` is
 * populated when extractable from the URL (canonical form or post-tiny-URL
 * resolution); absent when the URL is a tiny URL whose resolution failed —
 * that pathway also emits an `unfetchedLink` with reason `not-found`.
 */
export interface ConfluenceCandidate {
  url: string;
  sourceField: string;
  fieldLabel: string;
  title?: string;
  pageId?: string;
}

/**
 * Block returned in `UserStoryContext` when `ado_story` needs the user to
 * disambiguate which Confluence page(s) to treat as the Solution Design
 * source. The agent should surface the candidates as a numbered list and
 * re-call `ado_story` with `confluencePageUrls` set to the user's choice
 * (one URL, several URLs, or all of them).
 *
 * - `kind: "confluence-multi-field"` is the only kind today; reserved for
 *   future disambiguation flows (e.g. "non-confluence-source-required").
 * - `fetchedConfluencePages` is `[]` while a decision is pending: we
 *   deliberately don't fetch bodies until the user chooses, to avoid both
 *   wasted bandwidth and the risk of contaminating the test draft with a
 *   page the user didn't intend.
 */
export interface ConfluenceMultiFieldDecision {
  kind: "confluence-multi-field";
  message: string;
  candidates: ConfluenceCandidate[];
}
