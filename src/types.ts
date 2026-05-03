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
}

// ── Test Case Types ──

export interface TestStep {
  action: string;
  expectedResult: string;
}

export interface Prerequisites {
  personas?: string | string[] | null;
  preConditions?: string[] | null;
  testData?: string | null;
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
  tpmRoles: string;
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
