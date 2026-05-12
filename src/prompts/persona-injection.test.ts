/**
 * Tests for buildPersonaInjection — the helper that expands the workspace
 * persona config into a concrete instruction block for the /qa-draft
 * prompt. The injection is what stops the agent from inventing personas
 * like "Standard User" or "System Administrator" and instead forces it to
 * render the user's actual configured personas in the Common Persona
 * table.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPersonaInjection } from "./index.ts";

test("buildPersonaInjection: renders all configured personas", () => {
  const block = buildPersonaInjection(
    {
      Admin: {
        label: "Admin",
        profile: "Admin",
        roles: "Admin User",
        psg: "Admin_PSG",
      },
      SalesRep: {
        label: "Sales Rep",
        profile: "Sales_Rep",
        roles: "Sales_Rep",
        psg: "Sale_Rep_PSG",
      },
    },
    "Roles",
    "Permission Set Group",
  );
  assert.match(block, /\*\*Admin\*\*/);
  assert.match(block, /\*\*Sales Rep\*\*/);
  assert.match(block, /Profile: Admin/);
  assert.match(block, /Profile: Sales_Rep/);
  assert.match(block, /Roles: Admin User/);
  assert.match(block, /Permission Set Group: Sale_Rep_PSG/);
});

test("buildPersonaInjection: tells agent to use ONLY listed personas", () => {
  const block = buildPersonaInjection(
    {
      Admin: { label: "Admin", profile: "Admin", roles: "X", psg: "Y" },
    },
    "Roles",
    "Permission Set Group",
  );
  // The instruction must explicitly forbid invention.
  assert.match(block, /Use ONLY these personas/);
  assert.match(block, /Do NOT invent/i);
});

test("buildPersonaInjection: includes the System Administrator placeholder note", () => {
  const block = buildPersonaInjection(
    {
      Admin: { label: "Admin", profile: "Admin", roles: "X", psg: "Y" },
    },
    "Roles",
    "Permission Set Group",
  );
  // The note tells the user why "System Administrator" appears in
  // admin-validation TCs and how to override it.
  assert.match(block, /System Administrator/);
  assert.match(block, /admin-validation/i);
  assert.match(block, /\/ado-connect/);
});

test("buildPersonaInjection: empty config produces a clear empty-state instruction", () => {
  const block = buildPersonaInjection({}, "Roles", "Permission Set Group");
  assert.match(block, /NONE configured/);
  assert.match(block, /\/ado-connect/);
});

test("buildPersonaInjection: respects custom rolesLabel and psgLabel", () => {
  const block = buildPersonaInjection(
    {
      Foo: { label: "Foo", profile: "P", roles: "R", psg: "PSG-1" },
    },
    "TPM Roles",
    "PSG",
  );
  assert.match(block, /TPM Roles: R/);
  assert.match(block, /PSG: PSG-1/);
});

test("buildPersonaInjection: omits empty fields cleanly", () => {
  const block = buildPersonaInjection(
    {
      Bare: { label: "Bare", profile: "", roles: "", psg: "" },
    },
    "Roles",
    "Permission Set Group",
  );
  assert.match(block, /\*\*Bare\*\*/);
  assert.doesNotMatch(block, /Profile:/);
  assert.doesNotMatch(block, /Roles:/);
  assert.doesNotMatch(block, /Permission Set Group:/);
});

test("buildPersonaInjection: preserves persona insertion order", () => {
  const block = buildPersonaInjection(
    {
      Zeta: { label: "Z", profile: "p", roles: "r", psg: "g" },
      Alpha: { label: "A", profile: "p", roles: "r", psg: "g" },
      Mu: { label: "M", profile: "p", roles: "r", psg: "g" },
    },
    "Roles",
    "Permission Set Group",
  );
  const idxZ = block.indexOf("**Z**");
  const idxA = block.indexOf("**A**");
  const idxM = block.indexOf("**M**");
  assert.ok(idxZ >= 0 && idxA > idxZ && idxM > idxA, `expected Z<A<M, got ${idxZ}/${idxA}/${idxM}`);
});
