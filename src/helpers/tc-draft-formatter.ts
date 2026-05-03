/**
 * Formats structured test case draft data into reviewable markdown with tables.
 * Used by qa_draft_save to produce tc-drafts/US_<id>/US_<id>_test_cases.md
 * Includes Supporting Documents links to solution_design_summary and qa_cheat_sheet.
 */

import { loadConventionsConfig } from "../config.ts";
import { getSystemUsername } from "./system-username.ts";
import { buildTcTitle } from "./tc-title-builder.ts";
import type { PersonaConfig } from "../types.ts";

export interface TcDraftTestCase {
  tcNumber: number;
  featureTags: string[];
  useCaseSummary: string;
  priority?: number;
  prerequisites?: {
    personas?: string | string[] | null;
    preConditions?: string[] | null;
    testData?: string | null;
  };
  steps: Array<{ action: string; expectedResult: string }>;
  adoWorkItemId?: number;
}

export interface CoverageInsightRow {
  scenario: string;
  covered: boolean;
  positiveNegative: "P" | "N";
  functionalNonFunctional: "F" | "NF";
  priority: "High" | "Medium" | "Low";
  notes?: string;
}

export interface TcDraftData {
  userStoryId: number;
  storyTitle: string;
  storyState: string;
  areaPath: string;
  iterationPath: string;
  parentId?: number;
  parentTitle?: string;
  planId?: number;
  version: number;
  status: "DRAFT" | "APPROVED";
  lastUpdated: string;
  testCases: TcDraftTestCase[];
  /** Mermaid or process diagram based on understanding of the flow */
  functionalityProcessFlow?: string | null;
  /** Classified coverage scenarios with P/N, F/NF, priority */
  testCoverageInsights?: CoverageInsightRow[] | null;
  commonPrerequisites?: {
    personas?: string | string[] | null;
    preConditions?: string[] | null;
    testData?: string | null;
  };
}

export function formatTcDraftToMarkdown(data: TcDraftData): string {
  const config = loadConventionsConfig();
  const lines: string[] = [];

  // Header
  lines.push(`# Test Cases: US #${data.userStoryId} — ${escape(data.storyTitle)}`);
  lines.push("");
  const draftedBy = getSystemUsername();
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Status** | ${data.status} |`);
  lines.push(`| **Version** | ${data.version} |`);
  lines.push(`| **Last Updated** | ${data.lastUpdated} |`);
  lines.push(`| **Drafted By** | ${escape(draftedBy)} |`);
  lines.push(`| **Plan ID** | ${data.planId ?? "To be derived"} |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Supporting Documents (relative links to other files in the same US folder)
  lines.push("## Supporting Documents");
  lines.push("");
  lines.push(`- Solution Design Summary: [Open](./US_${data.userStoryId}_solution_design_summary.md)`);
  lines.push(`- QA Cheat Sheet: [Open](./US_${data.userStoryId}_qa_cheat_sheet.md)`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Functionality Process Flow (optional)
  if (data.functionalityProcessFlow?.trim()) {
    lines.push("## Functionality Process Flow");
    lines.push("");
    lines.push("_Based on understanding of US + Solution Design._");
    lines.push("");
    lines.push(data.functionalityProcessFlow.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Test Coverage Insights (optional)
  if (data.testCoverageInsights && data.testCoverageInsights.length > 0) {
    const rows = data.testCoverageInsights;
    const total = rows.length;
    const covered = rows.filter((r) => r.covered).length;
    const pct = Math.round((covered / total) * 100);
    const pCount = rows.filter((r) => r.positiveNegative === "P").length;
    const nCount = rows.filter((r) => r.positiveNegative === "N").length;
    const fCount = rows.filter((r) => r.functionalNonFunctional === "F").length;
    const nfCount = rows.filter((r) => r.functionalNonFunctional === "NF").length;

    lines.push("## Test Coverage Insights");
    lines.push("");
    lines.push("Coverage Summary:");
    lines.push(`- Total Scenarios: ${total}`);
    lines.push(`- Covered: ${covered}`);
    lines.push(`- Coverage: **${pct}%**`);
    lines.push(`- Distribution: ${pCount}P / ${nCount}N | ${fCount}F / ${nfCount}NF`);
    lines.push("");
    lines.push("| ID | Scenario | Covered | P/N | F/NF | Priority | Notes |");
    lines.push("|---|---|---|---|---|---|---|");
    rows.forEach((row, i) => {
      const covCell = row.covered ? "✅" : "❌";
      const pnCell = row.positiveNegative === "P" ? "🟢 P" : "🔴 N";
      const fnfCell = row.functionalNonFunctional === "F" ? "🔵 F" : "🟣 NF";
      const prioMap = { High: "🔴 High", Medium: "🟡 Medium", Low: "🟢 Low" } as const;
      const prioCell = prioMap[row.priority];
      lines.push(`| ${i + 1} | ${escape(row.scenario)} | ${covCell} | ${pnCell} | ${fnfCell} | ${prioCell} | ${escape(row.notes ?? "")} |`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Story Summary
  lines.push("## Story Summary");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| **US ID** | ${data.userStoryId} |`);
  lines.push(`| **Title** | ${escape(data.storyTitle)} |`);
  lines.push(`| **State** | ${escape(data.storyState)} |`);
  lines.push(`| **Area Path** | ${escape(data.areaPath)} |`);
  lines.push(`| **Iteration** | ${escape(data.iterationPath)} |`);
  const parentStr =
    data.parentId && data.parentTitle
      ? `#${data.parentId} — ${escape(data.parentTitle)}`
      : "—";
  lines.push(`| **Parent** | ${parentStr} |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Common Prerequisites
  lines.push("## Common Prerequisites");
  lines.push("");
  lines.push("These apply to **all test cases** below unless a specific TC states otherwise.");
  lines.push("");

  const common = data.commonPrerequisites ?? {};
  const { prerequisiteDefaults: defaults } = config;

  // Persona table
  lines.push("### Persona");
  lines.push("");
  // Persona: always all three defaults; no override
  const personaRows = buildPersonaTableRows(undefined, defaults.personas);
  lines.push("| Role | Profile | TPM Roles | PSG |");
  lines.push("|---|---|---|---|");
  for (const row of personaRows) {
    lines.push(`| ${row.role} | ${row.profile} | ${row.tpmRoles} | ${row.psg} |`);
  }
  lines.push("");

  // Pre-requisite
  lines.push("### Pre-requisite");
  lines.push("");
  // Pre-requisite is always unique per user story; never use config baseline
  const preConditions = common.preConditions ?? [];
  if (preConditions.length === 0) {
    lines.push("N/A");
  } else {
    lines.push("| # | Condition |");
    lines.push("|---|---|");
    preConditions.forEach((c, i) => {
      lines.push(`| ${i + 1} | ${escape(c)} |`);
    });
  }
  lines.push("");


  // Test Data
  lines.push("### Test Data");
  lines.push("");
  lines.push(common.testData ?? defaults.testData ?? "N/A");
  lines.push("");
  lines.push("---");
  lines.push("");

  // Each test case
  for (const tc of data.testCases) {
    const title = buildTcTitle(data.userStoryId, tc.tcNumber, tc.featureTags, tc.useCaseSummary);
    const adoIdSuffix = tc.adoWorkItemId ? ` (ADO #${tc.adoWorkItemId})` : "";
    lines.push(`## Test Case ${tc.tcNumber}`);
    lines.push("");
    lines.push(`**${title}${adoIdSuffix}**`);
    lines.push("");
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(`| **Priority** | ${tc.priority ?? config.testCaseDefaults.priority} |`);
    lines.push(`| **Use Case** | ${escape(tc.useCaseSummary)} |`);
    lines.push("");

    // TC-specific pre-requisite overrides (only if different from common)
    const hasTcPreConditions =
      tc.prerequisites?.preConditions && tc.prerequisites.preConditions.length > 0;
    if (hasTcPreConditions) {
      lines.push("**Additional Pre-requisite (TC-specific):**");
      lines.push("");
      lines.push("| # | Condition |");
      lines.push("|---|---|");
      tc.prerequisites!.preConditions!.forEach((c, i) => {
        lines.push(`| ${i + 1} | ${escape(c)} |`);
      });
      lines.push("");
    }

    // Steps
    lines.push("**Steps:**");
    lines.push("");
    lines.push("| # | Action | Expected Result |");
    lines.push("|---|---|---|");
    tc.steps.forEach((s, i) => {
      lines.push(`| ${i + 1} | ${escape(s.action)} | ${escape(s.expectedResult)} |`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Review Notes
  lines.push("## Review Notes");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push("| **Reviewer** | |");
  lines.push("| **Date Reviewed** | |");
  lines.push("");
  lines.push("**Feedback:**");
  lines.push("");
  lines.push("_Add your review comments here. The AI will revise the draft based on your feedback._");
  lines.push("");
  lines.push("- ");
  lines.push("- ");
  lines.push("");

  return lines.join("\n");
}

function buildPersonaTableRows(
  override: string | string[] | null | undefined,
  defaultPersonas: Record<string, PersonaConfig>
): Array<{ role: string; profile: string; tpmRoles: string; psg: string }> {
  const keys =
    Array.isArray(override) && override.length > 0
      ? override
      : Object.keys(defaultPersonas);

  return keys
    .map((key) => {
      const p = defaultPersonas[key];
      if (!p) return null;
      return {
        role: escape(p.label),
        profile: escape(p.profile),
        tpmRoles: escape(p.tpmRoles),
        psg: escape(p.psg),
      };
    })
    .filter((r): r is { role: string; profile: string; tpmRoles: string; psg: string } => r !== null);
}

function escape(s: string): string {
  return String(s)
    .replace(/\|/g, "&#124;")
    .replace(/\n/g, " ")
    .trim();
}
