/**
 * Parses markdown draft back to TcDraftData for push to ADO.
 * Used when JSON is deferred until push.
 * Supports drafts from tc-drafts/US_<id>/US_<id>_test_cases.md (new layout)
 * and tc-drafts/US_<id>_test_cases.md (legacy flat layout).
 */

import { loadConventionsConfig } from "../config.ts";
import type { TcDraftData, TcDraftTestCase, CoverageInsightRow } from "./tc-draft-formatter.ts";
import type { PrereqTable } from "../types.ts";

function unescape(s: string): string {
  return String(s)
    .replace(/&#124;/g, "|")
    .trim();
}

/**
 * Extract a multi-column Markdown table from a Pre-requisite section block.
 *
 * Recognises Markdown tables of the shape:
 *
 *   | Col A | Col B | Col C |
 *   |---|---|---|
 *   | row1a | row1b | row1c |
 *   | row2a | row2b | row2c |
 *
 * Returns `null` when the section has no table, only a 2-column `| # | Condition |`
 * table (handled by the existing flat `preConditions[]` path), or fewer than 1 data row.
 */
function parsePreReqTable(section: string): PrereqTable | null {
  if (!section) return null;
  const lines = section.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 3) return null; // need header + separator + >=1 data row
  const splitRow = (row: string): string[] => {
    const cells = row.split("|").slice(1, -1).map((c) => unescape(c.trim()));
    return cells;
  };
  const headers = splitRow(lines[0]!);
  // Reject 2-column `# | Condition` shape — the flat preConditions[] path handles that.
  if (headers.length <= 2) return null;
  // Separator row must look like `|---|---|---|`
  if (!/^\|[\s|:-]+\|$/.test(lines[1]!)) return null;
  const rows = lines.slice(2).map(splitRow).filter((r) => r.length === headers.length);
  if (rows.length === 0) return null;
  return { headers, rows };
}

function parseTableValue(content: string, fieldName: string): string | null {
  const re = new RegExp(
    `\\|\\s*\\*\\*${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*\\s*\\|\\s*([^|]*)\\|`,
    "i"
  );
  const m = content.match(re);
  return m ? unescape(m[1].trim()) : null;
}

function parseTcTitle(title: string): { tcNumber: number; featureTags: string[]; useCaseSummary: string } | null {
  // Support both " -> " and " → " (Unicode arrow)
  const tcMatch = title.match(/^TC_(\d+)_(\d+)\s*(?:->|→)\s*(.+)$/);
  if (!tcMatch) return null;
  const [, , tcNum, rest] = tcMatch;
  const parts = rest.split(/\s*(?:->|→)\s*/);
  if (parts.length < 2) return null;
  const useCaseSummary = parts[parts.length - 1];
  const featureTags = parts.slice(0, -1);
  return {
    tcNumber: parseInt(tcNum!, 10),
    featureTags,
    useCaseSummary,
  };
}

function parseStepsTable(section: string): Array<{ action: string; expectedResult: string }> {
  const stepsBlock = section.match(/\*\*Steps:\*\*\s*\n\s*\n([\s\S]*?)(?=\n\n---|\n\n##|$)/);
  if (!stepsBlock) return [];
  const table = stepsBlock[1];
  const rows = table.match(/\|\s*\d+\s*\|\s*[^|]+\|\s*[^|]+\|/g);
  if (!rows) return [];
  return rows.map((row) => {
    const parts = row.split("|").map((p) => unescape(p.trim())).filter(Boolean);
    return { action: parts[1] ?? "", expectedResult: parts[2] ?? "" };
  });
}

export function parseTcDraftFromMarkdown(mdContent: string): TcDraftData | null {
  const config = loadConventionsConfig();

  // Extract header section: from start to first ## heading (robust against new sections like Supporting Documents)
  const firstH2 = mdContent.indexOf("\n## ");
  const headerSection = firstH2 >= 0 ? mdContent.slice(0, firstH2) : mdContent.slice(0, 1500);
  const status = parseTableValue(headerSection, "Status") ?? "DRAFT";
  const versionStr = parseTableValue(headerSection, "Version");
  const version = versionStr ? parseInt(versionStr, 10) : 1;
  const lastUpdated = parseTableValue(headerSection, "Last Updated") ?? new Date().toISOString().slice(0, 10);
  const planIdStr = parseTableValue(headerSection, "Plan ID");
  const planId = planIdStr && planIdStr !== "To be derived" ? parseInt(planIdStr, 10) : undefined;

  const titleMatch = mdContent.match(/^# Test Cases: US #(\d+) — (.+)$/m);
  if (!titleMatch) return null;
  const userStoryId = parseInt(titleMatch[1], 10);
  const storyTitle = unescape(titleMatch[2]);

  let functionalityProcessFlow: string | undefined;
  const processFlowStart = mdContent.indexOf("## Functionality Process Flow");
  if (processFlowStart >= 0) {
    const afterHeader = mdContent.slice(processFlowStart + "## Functionality Process Flow".length);
    const endMatch = afterHeader.match(/\n\n---\n\n|\n\n## /);
    const end = endMatch ? endMatch.index! : afterHeader.length;
    const content = afterHeader.slice(0, end).replace(/^\s*\n/, "").trim();
    if (content) functionalityProcessFlow = content;
  }

  let testCoverageInsights: CoverageInsightRow[] | undefined;
  const insightsStart = mdContent.indexOf("## Test Coverage Insights");
  if (insightsStart >= 0) {
    const afterHeader = mdContent.slice(insightsStart);
    const endMatch = afterHeader.match(/\n\n---\n\n|\n\n## Story Summary/);
    const block = endMatch ? afterHeader.slice(0, endMatch.index) : afterHeader;
    const tableRows = block.match(/\|\s*\d+\s*\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]*\|/g);
    if (tableRows && tableRows.length > 0) {
      const parsed: CoverageInsightRow[] = [];
      for (const row of tableRows) {
        const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length < 6) continue;
        const scenario = unescape(cells[1]);
        const covRaw = cells[2].replace(/<[^>]*>/g, "").replace(/[✅✔]/g, "Y").replace(/[❌✘]/g, "N").trim();
        const covered = covRaw.startsWith("Y");
        const pnText = cells[3].replace(/[🟢🔴🔵🟣🟡]/g, "").trim();
        const pnRaw = (pnText === "P" ? "P" : "N") as "P" | "N";
        const fnfText = cells[4].replace(/[🟢🔴🔵🟣🟡]/g, "").trim();
        const fnfRaw = (fnfText === "NF" ? "NF" : "F") as "F" | "NF";
        const prioText = cells[5].replace(/[🟢🔴🔵🟣🟡]/g, "").trim();
        const priority = (["High", "Medium", "Low"].includes(prioText) ? prioText : "Medium") as "High" | "Medium" | "Low";
        const notes = cells[6] ? unescape(cells[6]) : undefined;
        if (scenario && scenario !== "Scenario") {
          parsed.push({ scenario, covered, positiveNegative: pnRaw, functionalNonFunctional: fnfRaw, priority, notes: notes || undefined });
        }
      }
      if (parsed.length > 0) testCoverageInsights = parsed;
    }
  }

  const storySummaryStart = mdContent.indexOf("## Story Summary");
  const storySummaryEnd = mdContent.indexOf("---", storySummaryStart + 1);
  const storySummary = mdContent.slice(storySummaryStart, storySummaryEnd);
  const storyState = parseTableValue(storySummary, "State") ?? "";
  const areaPath = parseTableValue(storySummary, "Area Path") ?? "";
  const iterationPath = parseTableValue(storySummary, "Iteration") ?? "";
  const parentStr = parseTableValue(storySummary, "Parent");
  let parentId: number | undefined;
  let parentTitle: string | undefined;
  if (parentStr && parentStr !== "—") {
    const parentMatch = parentStr.match(/^#(\d+)\s*—\s*(.+)$/);
    if (parentMatch) {
      parentId = parseInt(parentMatch[1], 10);
      parentTitle = unescape(parentMatch[2]);
    }
  }

  const commonStart = mdContent.indexOf("## Common Prerequisites");
  const commonEnd = mdContent.indexOf("## Test Case 1");
  const commonSection = commonEnd >= 0 ? mdContent.slice(commonStart, commonEnd) : mdContent.slice(commonStart);

  // Extract Pre-requisite section only (between ### Pre-requisite and next ### section)
  const preReqStart = commonSection.indexOf("### Pre-requisite");
  const preReqEnd =
    preReqStart >= 0
      ? [commonSection.indexOf("### TO BE TESTED FOR", preReqStart), commonSection.indexOf("### Test Data", preReqStart)]
          .filter((i) => i >= 0)
          .reduce((a, b) => Math.min(a, b), commonSection.length)
      : 0;
  const preReqSection = preReqStart >= 0 ? commonSection.slice(preReqStart, preReqEnd) : "";
  const preCondRows = preReqSection.match(/\|\s*\d+\s*\|\s*([^|]+)\|/g);
  const preConditions = preCondRows
    ? preCondRows.map((r) => unescape(r.replace(/\|\s*\d+\s*\|\s*([^|]+)\|/, "$1").trim()))
    : [];

  // Structured multi-column Pre-requisite table capture. When reviewers author a
  // prereq section as a full Markdown table (3+ columns, e.g. `| # | Component | Required State |`),
  // preserve headers + row cells so the HTML builder can emit a real <table> in ADO.
  // For 2-column tables (`| # | Condition |`) the flat `preConditions[]` is sufficient; we
  // intentionally leave preConditionsTable undefined so the builder falls back to the existing <ol>.
  const preConditionsTable = parsePreReqTable(preReqSection);

  const testDataBlock = commonSection.match(/### Test Data\s*\n\s*\n([^\n#-]+)/);
  const testData = testDataBlock && testDataBlock[1].trim() && testDataBlock[1].trim() !== "N/A"
    ? unescape(testDataBlock[1].trim())
    : "N/A";

  const commonPrerequisites = {
    preConditions: preConditions.length > 0 ? preConditions : undefined,
    preConditionsTable: preConditionsTable ?? undefined,
    testData,
  };

  const testCases: TcDraftTestCase[] = [];
  const tcSectionMatches = mdContent.matchAll(/## Test Case (\d+)\s*\n\s*\n\*\*(.+?)\*\*/gs);

  for (const m of tcSectionMatches) {
    const tcNum = parseInt(m[1], 10);
    const titleLine = m[2];
    const parsed = parseTcTitle(titleLine);
    const sectionStart = m.index!;
    const nextMatch = mdContent.slice(sectionStart).match(/\n## Test Case \d+/);
    const sectionEnd = nextMatch ? sectionStart + nextMatch.index! : mdContent.length;
    const section = mdContent.slice(sectionStart, sectionEnd);

    const adoIdMatch = section.match(/\(ADO #(\d+)\)/);
    const priorityStr = parseTableValue(section, "Priority");
    const priority = priorityStr ? parseInt(priorityStr, 10) : config.testCaseDefaults.priority;
    const useCaseSummary = parseTableValue(section, "Use Case") ?? (parsed?.useCaseSummary ?? "");

    const steps = parseStepsTable(section);
    if (steps.length === 0) continue;

    // Per-TC Pre-requisite extraction.
    // Canonical heading: `### Pre-requisite (specific to this TC)` — cleaner and matches reviewer convention.
    // Back-compat: also accept the old `**Additional Pre-requisite (TC-specific):**` inline label.
    // Both paths extract flat (2-col) list and/or structured (3+ col) table.
    let tcPreConditions: string[] = [];
    let tcPreConditionsTable: PrereqTable | null = null;

    // Try canonical ### heading first
    const canonicalMatch = section.match(
      /###\s+Pre-requisite\s*\(specific to this TC\)\s*\n([\s\S]*?)(?=\n###\s|\n\*\*Steps:\*\*|\n---\n|\n##\s|$)/i,
    );
    if (canonicalMatch) {
      const block = canonicalMatch[1];
      const rows = block.match(/\|\s*\d+\s*\|\s*([^|]+)\|/g);
      if (rows) {
        tcPreConditions = rows.map((r) =>
          unescape(r.replace(/\|\s*\d+\s*\|\s*([^|]+)\|/, "$1").trim()),
        );
      }
      tcPreConditionsTable = parsePreReqTable(block);
    } else {
      // Back-compat fallback
      const legacyMatch = section.match(
        /\*\*Additional Pre-requisite \(TC-specific\):\*\*[\s\S]*?(\|\s*\d+\s*\|\s*[^|]+\|(?:\s*\n\s*\|\s*\d+\s*\|\s*[^|]+\|)*)/,
      );
      if (legacyMatch) {
        tcPreConditions =
          legacyMatch[1]
            .match(/\|\s*\d+\s*\|\s*([^|]+)\|/g)
            ?.map((r) => unescape(r.replace(/\|\s*\d+\s*\|\s*([^|]+)\|/, "$1").trim())) ?? [];
      }
    }

    const featureTags = parsed?.featureTags ?? [useCaseSummary.split(" ").slice(0, 3).join(" ")];

    const hasPerTcPrereq = tcPreConditions.length > 0 || tcPreConditionsTable !== null;
    testCases.push({
      tcNumber: tcNum,
      featureTags,
      useCaseSummary,
      priority,
      prerequisites: hasPerTcPrereq
        ? {
            preConditions: tcPreConditions.length > 0 ? tcPreConditions : undefined,
            preConditionsTable: tcPreConditionsTable ?? undefined,
          }
        : undefined,
      steps,
      adoWorkItemId: adoIdMatch ? parseInt(adoIdMatch[1], 10) : undefined,
    });
  }

  if (testCases.length === 0) return null;

  return {
    userStoryId,
    storyTitle,
    storyState,
    areaPath,
    iterationPath,
    parentId,
    parentTitle,
    planId,
    version,
    status: status as "DRAFT" | "APPROVED",
    lastUpdated,
    testCases,
    functionalityProcessFlow,
    testCoverageInsights,
    commonPrerequisites,
  };
}
