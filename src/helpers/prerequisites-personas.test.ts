/**
 * Tests covering the persona-section behavior of `buildPrerequisitesHtml`,
 * which produces the HTML written to the ADO test case Description /
 * Prerequisite field at publish time.
 *
 * Mirrors the draft-side rule landed in src/helpers/tc-draft-formatter.ts:
 * when the workspace config has zero personas configured, the Persona
 * heading + bullet list is omitted entirely. Prevents an empty
 * `<div><strong>Persona:</strong></div><ul></ul>` placeholder from
 * appearing on every published TC.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrerequisitesHtml } from "./prerequisites.ts";
import type { ConventionsConfig } from "../types.ts";

function configWithPersonas(
  personas: Record<string, { label: string; profile: string; roles: string; psg: string }>,
): ConventionsConfig {
  return {
    testCaseTitle: {
      prefix: "TC",
      separator: " -> ",
      numberPadding: 2,
      template: "{prefix}_{usId}_{tcNumber}{separator}{featureTags}{separator}{summary}",
      maxLength: 256,
    },
    prerequisites: {
      heading: "Prerequisites for Test:",
      sections: [
        { key: "personas", label: "Persona", required: true },
        { key: "preConditions", label: "Pre-requisite", required: true },
        { key: "testData", label: "Test Data", required: false },
      ],
    },
    prerequisiteDefaults: {
      personas,
      personaRolesLabel: "Roles",
      personaPsgLabel: "Permission Set Group",
      commonPreConditions: [],
      toBeTested: null,
      testData: "N/A",
    },
    suiteStructure: {
      sprintPrefix: "Sprint_",
      parentUsSeparator: " | ",
      parentUsTemplate: "{id}{separator}{title}",
      usTemplate: "{id}{separator}{title}",
      nonEpicFolderName: "Non-Epic US TCs",
      tcTitlePrefix: "TC",
    },
    testCaseDefaults: { state: "Design", priority: 2 },
  };
}

test("buildPrerequisitesHtml: emits Persona block when config has personas", () => {
  const cfg = configWithPersonas({
    Admin: {
      label: "Admin",
      profile: "Admin Profile",
      roles: "Admin User",
      psg: "Admin_PSG",
    },
  });
  const html = buildPrerequisitesHtml({}, cfg);
  assert.match(html, /<strong>Persona:<\/strong>/);
  assert.match(html, /Admin Profile/);
  assert.match(html, /Roles = Admin User/);
  assert.match(html, /Permission Set Group = Admin_PSG/);
});

test("buildPrerequisitesHtml: OMITS Persona block entirely when config has no personas", () => {
  const cfg = configWithPersonas({});
  const html = buildPrerequisitesHtml({}, cfg);
  // No heading, no empty list — the published TC must not show a bare
  // "Persona:" with nothing under it.
  assert.doesNotMatch(html, /<strong>Persona:<\/strong>/);
  assert.doesNotMatch(html, /<ul><\/ul>/);
});

test("buildPrerequisitesHtml: persona omission does NOT suppress other sections", () => {
  const cfg = configWithPersonas({});
  const html = buildPrerequisitesHtml(
    { preConditions: ["Email-to-Case = Enabled"] },
    cfg,
  );
  // Persona block gone, but Pre-requisite still emitted.
  assert.doesNotMatch(html, /<strong>Persona:<\/strong>/);
  assert.match(html, /<strong>Pre-requisite:<\/strong>/);
  assert.match(html, /Email-to-Case = Enabled/);
});

test("buildPrerequisitesHtml: persona omission survives custom personaRolesLabel/psgLabel", () => {
  const cfg = configWithPersonas({});
  cfg.prerequisiteDefaults.personaRolesLabel = "TPM Roles";
  cfg.prerequisiteDefaults.personaPsgLabel = "PSG";
  const html = buildPrerequisitesHtml({}, cfg);
  assert.doesNotMatch(html, /<strong>Persona:<\/strong>/);
  assert.doesNotMatch(html, /TPM Roles =/);
  assert.doesNotMatch(html, /PSG =/);
});
