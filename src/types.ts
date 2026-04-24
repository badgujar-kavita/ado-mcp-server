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
  solutionDesignUrl: string | null;
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
