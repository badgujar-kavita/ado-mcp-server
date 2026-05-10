/**
 * WorkspaceConfigSchema validation tests — accept valid configs, reject
 * invalid ones with clear errors. Stress-tests the on-disk surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceConfigSchema } from "./schema.ts";

test("schema: minimal valid config (just version)", () => {
  const result = WorkspaceConfigSchema.safeParse({ version: 1 });
  assert.equal(result.success, true);
});

test("schema: rejects wrong version literal", () => {
  const result = WorkspaceConfigSchema.safeParse({ version: 2 });
  assert.equal(result.success, false);
});

test("schema: rejects missing version", () => {
  const result = WorkspaceConfigSchema.safeParse({});
  assert.equal(result.success, false);
});

test("schema: full ado block valid", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    ado: {
      url: "https://dev.azure.com/myorg",
      org: "myorg",
      project: "Project_ABC",
      setupAt: "2026-05-10T...",
      fieldRefs: {
        prerequisite: "Custom.PrerequisiteforTest",
        solutionDesign: "Custom.TechnicalSolution",
      },
    },
  });
  assert.equal(result.success, true);
});

test("schema: rejects ado.url that's not a URL", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    ado: { url: "not-a-url", org: "o", project: "p" },
  });
  assert.equal(result.success, false);
});

test("schema: rejects empty ado.org", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    ado: { url: "https://dev.azure.com/o", org: "", project: "p" },
  });
  assert.equal(result.success, false);
});

test("schema: rejects empty ado.project", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    ado: { url: "https://dev.azure.com/o", org: "o", project: "" },
  });
  assert.equal(result.success, false);
});

test("schema: confluence block valid (fully populated)", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    confluence: {
      enabled: true,
      url: "https://example.atlassian.net/wiki",
      email: "user@example.com",
    },
  });
  assert.equal(result.success, true);
});

test("schema: rejects confluence.email that's not an email", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    confluence: { enabled: true, email: "not-an-email" },
  });
  assert.equal(result.success, false);
});

test("schema: persona with missing required fields rejected", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    prerequisiteDefaults: {
      personas: {
        BadPersona: { label: "x" }, // missing profile, roles, psg
      },
    },
  });
  assert.equal(result.success, false);
});

test("schema: persona with all required fields accepted", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    prerequisiteDefaults: {
      personas: {
        GoodPersona: {
          label: "Good",
          profile: "Profile1",
          roles: "Role1",
          psg: "PSG1",
        },
      },
    },
  });
  assert.equal(result.success, true);
});

test("schema: legacy tpmRoles field on persona is mapped to roles", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    prerequisiteDefaults: {
      personas: {
        Legacy: {
          label: "x",
          profile: "p",
          tpmRoles: "TPM Admin",
          psg: "PSG",
        },
      },
    },
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.prerequisiteDefaults?.personas?.Legacy.roles, "TPM Admin");
  }
});

test("schema: testPlanMapping accepts string OR string[] for areaPathContains", () => {
  const r1 = WorkspaceConfigSchema.safeParse({
    version: 1,
    suiteStructure: {
      testPlanMapping: [{ planId: 1, areaPathContains: "Single" }],
    },
  });
  assert.equal(r1.success, true);

  const r2 = WorkspaceConfigSchema.safeParse({
    version: 1,
    suiteStructure: {
      testPlanMapping: [{ planId: 1, areaPathContains: ["A", "B"] }],
    },
  });
  assert.equal(r2.success, true);
});

test("schema: testPlanMapping rejects non-positive planId", () => {
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    suiteStructure: {
      testPlanMapping: [{ planId: 0, areaPathContains: "x" }],
    },
  });
  assert.equal(result.success, false);
});

test("schema: testCaseDefaults.priority must be 1-4", () => {
  const r1 = WorkspaceConfigSchema.safeParse({
    version: 1,
    testCaseDefaults: { priority: 5 },
  });
  assert.equal(r1.success, false);

  const r2 = WorkspaceConfigSchema.safeParse({
    version: 1,
    testCaseDefaults: { priority: 0 },
  });
  assert.equal(r2.success, false);

  const r3 = WorkspaceConfigSchema.safeParse({
    version: 1,
    testCaseDefaults: { priority: 3 },
  });
  assert.equal(r3.success, true);
});

test("schema: rejects unknown fields gracefully (zod default is strip)", () => {
  // zod's default behavior: unknown fields are silently dropped, not rejected.
  // This is intentional — tenants who experiment with future fields shouldn't
  // get hard parse failures.
  const result = WorkspaceConfigSchema.safeParse({
    version: 1,
    futureUnknownField: "experiment",
    ado: {
      url: "https://dev.azure.com/o",
      org: "o",
      project: "p",
    },
  });
  assert.equal(result.success, true);
  if (result.success) {
    // Unknown field is dropped from the parsed result.
    assert.equal((result.data as Record<string, unknown>).futureUnknownField, undefined);
  }
});

test("schema: realistic full config from the design doc parses cleanly", () => {
  const realistic = {
    version: 1,
    ado: {
      url: "https://dev.azure.com/MarsDevTeam",
      org: "MarsDevTeam",
      project: "TPM Product Ecosystem",
      setupAt: "2026-05-10T14:30:00.000Z",
      fieldRefs: {
        prerequisite: "Custom.PrerequisiteforTest",
        solutionDesign: "Custom.TechnicalSolution",
      },
    },
    confluence: {
      enabled: true,
      url: "https://marsdevteam.atlassian.net/wiki",
      email: "kavita@example.com",
    },
    testCaseTitle: { prefix: "TC_" },
    prerequisiteDefaults: {
      personas: {
        SystemAdministrator: {
          label: "System Administrator",
          profile: "System Admin",
          roles: "—",
          psg: "—",
        },
        AdminUser: {
          label: '"ADMIN User" User',
          profile: "TPM_User_Profile",
          user: '"ADMIN User" User',
          roles: "ADMIN",
          psg: "TPM Global ADMIN Users",
        },
        KAM: {
          label: "Key Account Manager (KAM) User",
          profile: "TPM_User_Profile",
          roles: "KAM",
          psg: "TPM Global KAM Users PSG",
        },
      },
      personaRolesLabel: "TPM Roles",
      personaPsgLabel: "PSG",
    },
    suiteStructure: {
      sprintPrefix: "SFTPM_",
      tcTitlePrefix: "TC",
      testPlanMapping: [
        { planId: 1066479, areaPathContains: ["DHub", "D-HUB"] },
        { planId: 1066480, areaPathContains: ["EHub", "E-HUB"] },
      ],
    },
    additionalContextFields: [
      {
        adoFieldRef: "Custom.ImpactAssessment",
        label: "Impact Assessment",
        fetchLinks: true,
        fetchImages: true,
      },
    ],
  };
  const result = WorkspaceConfigSchema.safeParse(realistic);
  assert.equal(result.success, true);
});
