/**
 * Parses markdown draft back to TcDraftData for push to ADO.
 * Used when JSON is deferred until push.
 */

import { loadConventionsConfig } from "../config.ts";
import type { TcDraftData, TcDraftTestCase, CoverageInsightRow } from "./tc-draft-formatter.ts";

function unescape(s: string): string {
  return String(s)
    .replace(/&#124;/g, "|")
    .trim();
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

  const headerTable = mdContent.slice(0, 800);
  const status = parseTableValue(headerTable, "Status") ?? "DRAFT";
  const versionStr = parseTableValue(headerTable, "Version");
  const version = versionStr ? parseInt(versionStr, 10) : 1;
  const lastUpdated = parseTableValue(headerTable, "Last Updated") ?? new Date().toISOString().slice(0, 10);
  const planIdStr = parseTableValue(headerTable, "Plan ID");
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
        const covRaw = cells[2].replace(/<[^>]*>/g, "").trim();
        const covered = covRaw === "✔";
        const pnRaw = cells[3].replace(/<[^>]*>/g, "").trim() as "P" | "N";
        const fnfRaw = cells[4].trim() as "F" | "NF";
        const priority = cells[5].trim() as "High" | "Medium" | "Low";
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

  const testDataBlock = commonSection.match(/### Test Data\s*\n\s*\n([^\n#-]+)/);
  const testData = testDataBlock && testDataBlock[1].trim() && testDataBlock[1].trim() !== "N/A"
    ? unescape(testDataBlock[1].trim())
    : "N/A";

  // Extract TO BE TESTED FOR section only (between ### TO BE TESTED FOR and ### Test Data)
  const toBeTestedStart = commonSection.indexOf("### TO BE TESTED FOR");
  const toBeTestedEnd =
    toBeTestedStart >= 0
      ? (() => {
          const idx = commonSection.indexOf("### Test Data", toBeTestedStart);
          return idx >= 0 ? idx : commonSection.length;
        })()
      : 0;
  const toBeTestedSection = toBeTestedStart >= 0 ? commonSection.slice(toBeTestedStart, toBeTestedEnd) : "";
  const toBeTestedRows = toBeTestedSection.match(/\|\s*\d+\s*\|\s*([^|]+)\|/g);
  const toBeTested = toBeTestedRows
    ? toBeTestedRows.map((r) => unescape(r.replace(/\|\s*\d+\s*\|\s*([^|]+)\|/, "$1").trim())).filter((v) => v && v !== "N/A" && v !== "Validation")
    : [];

  const commonPrerequisites = {
    preConditions: preConditions.length > 0 ? preConditions : undefined,
    toBeTested: toBeTested.length > 0 ? toBeTested : undefined,
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

    const tcPreCondBlock = section.match(/\*\*Additional Pre-requisite \(TC-specific\):\*\*[\s\S]*?(\|\s*\d+\s*\|\s*[^|]+\|(?:\s*\n\s*\|\s*\d+\s*\|\s*[^|]+\|)*)/);
    const tcPreConditions = tcPreCondBlock
      ? tcPreCondBlock[1].match(/\|\s*\d+\s*\|\s*([^|]+)\|/g)?.map((r) => unescape(r.replace(/\|\s*\d+\s*\|\s*([^|]+)\|/, "$1").trim())) ?? []
      : [];

    const featureTags = parsed?.featureTags ?? [useCaseSummary.split(" ").slice(0, 3).join(" ")];

    testCases.push({
      tcNumber: tcNum,
      featureTags,
      useCaseSummary,
      priority,
      prerequisites: tcPreConditions.length > 0 ? { preConditions: tcPreConditions } : undefined,
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
