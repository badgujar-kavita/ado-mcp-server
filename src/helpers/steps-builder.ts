import type { TestStep } from "../types.ts";
import { formatStepContent } from "./format-html.ts";

/**
 * Converts an array of test steps into the ADO XML format
 * used by the Microsoft.VSTS.TCM.Steps field.
 * Applies formatting (**bold**, A./B. lists) before XML escaping.
 */
export function buildStepsXml(steps: TestStep[]): string {
  if (steps.length === 0) return "";

  const stepElements = steps
    .map((step, idx) => {
      const id = idx + 1;
      const action = escapeXml(formatStepContent(step.action));
      const expected = escapeXml(formatStepContent(step.expectedResult));
      return (
        `<step id="${id}" type="ActionStep">` +
        `<parameterizedString isformatted="true">${action}</parameterizedString>` +
        `<parameterizedString isformatted="true">${expected}</parameterizedString>` +
        `</step>`
      );
    })
    .join("");

  return `<steps id="0" last="${steps.length}">${stepElements}</steps>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
