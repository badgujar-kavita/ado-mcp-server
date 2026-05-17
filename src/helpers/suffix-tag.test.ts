/**
 * Unit tests for `suffix-tag.ts` — pure functions only, no fixtures.
 *
 * Coverage: every documented mapping (regression/e2e/sit/uat/smoke/performance),
 * the canonical-vs-undefined branch, custom suffix derivation (uppercase only,
 * 5-char cap, hyphen/underscore stripping), and the validation regex.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_KNOWN_TAGS,
  assertValidSuffix,
  suffixToTag,
  tagToSuffix,
  tagToSuffixHint,
} from "./suffix-tag.ts";

// ── suffixToTag — canonical mappings ──

test("suffixToTag(undefined) returns undefined (canonical, no tag)", () => {
  assert.equal(suffixToTag(undefined), undefined);
});

test("suffixToTag(null) returns undefined (canonical, no tag)", () => {
  assert.equal(suffixToTag(null), undefined);
});

test("suffixToTag('regression') -> 'REG'", () => {
  assert.equal(suffixToTag("regression"), "REG");
});

test("suffixToTag('e2e') -> 'E2E'", () => {
  assert.equal(suffixToTag("e2e"), "E2E");
});

test("suffixToTag('sit') -> 'SIT'", () => {
  assert.equal(suffixToTag("sit"), "SIT");
});

test("suffixToTag('uat') -> 'UAT'", () => {
  assert.equal(suffixToTag("uat"), "UAT");
});

test("suffixToTag('smoke') -> 'SMOKE'", () => {
  assert.equal(suffixToTag("smoke"), "SMOKE");
});

test("suffixToTag('performance') -> 'PERF'", () => {
  assert.equal(suffixToTag("performance"), "PERF");
});

// ── suffixToTag — custom suffixes ──

test("suffixToTag('accessibility') derives 'ACCES' (5-char cap)", () => {
  assert.equal(suffixToTag("accessibility"), "ACCES");
});

test("suffixToTag('security') derives 'SECUR'", () => {
  assert.equal(suffixToTag("security"), "SECUR");
});

test("suffixToTag('a11y') keeps digits and caps at 5 chars", () => {
  assert.equal(suffixToTag("a11y"), "A11Y");
});

test("suffixToTag('hyphen-test') strips hyphens and caps at 5 chars", () => {
  assert.equal(suffixToTag("hyphen-test"), "HYPHE");
});

test("suffixToTag('under_score') strips underscores", () => {
  assert.equal(suffixToTag("under_score"), "UNDER");
});

test("suffixToTag('ab') returns short uppercase 'AB'", () => {
  assert.equal(suffixToTag("ab"), "AB");
});

// ── suffixToTag — validation ──

test("suffixToTag('') throws — empty string is rejected", () => {
  assert.throws(() => suffixToTag(""), /Invalid suffix.*empty string/);
});

test("suffixToTag('UPPER') throws — uppercase letters rejected", () => {
  assert.throws(() => suffixToTag("UPPER"), /^TypeError: Invalid suffix/);
});

test("suffixToTag('with space') throws — space rejected", () => {
  assert.throws(() => suffixToTag("with space"), /^TypeError: Invalid suffix/);
});

test("suffixToTag('with.dot') throws — punctuation other than _- rejected", () => {
  assert.throws(() => suffixToTag("with.dot"), /^TypeError: Invalid suffix/);
});

// ── assertValidSuffix ──

test("assertValidSuffix(undefined) does not throw", () => {
  assert.doesNotThrow(() => assertValidSuffix(undefined));
});

test("assertValidSuffix(null) does not throw", () => {
  assert.doesNotThrow(() => assertValidSuffix(null));
});

test("assertValidSuffix('regression') passes", () => {
  assert.doesNotThrow(() => assertValidSuffix("regression"));
});

test("assertValidSuffix('e2e') passes", () => {
  assert.doesNotThrow(() => assertValidSuffix("e2e"));
});

test("assertValidSuffix(123) throws TypeError (non-string input)", () => {
  // Validate runtime behavior on a non-string call site (TypeScript would flag,
  // but we still want a defensive guard).
  assert.throws(() => assertValidSuffix(123 as unknown as string), /^TypeError/);
});

// ── ALL_KNOWN_TAGS ──

test("ALL_KNOWN_TAGS includes every canonical tag", () => {
  for (const expected of ["REG", "E2E", "SIT", "UAT", "SMOKE", "PERF"]) {
    assert.ok(ALL_KNOWN_TAGS.includes(expected), `Expected ALL_KNOWN_TAGS to include ${expected}`);
  }
});

test("ALL_KNOWN_TAGS is frozen (immutable)", () => {
  assert.throws(() => (ALL_KNOWN_TAGS as unknown as string[]).push("X"));
});

// ── tagToSuffixHint reverse lookup ──

test("tagToSuffixHint('REG') returns 'regression'", () => {
  assert.equal(tagToSuffixHint("REG"), "regression");
});

test("tagToSuffixHint('E2E') returns 'e2e'", () => {
  assert.equal(tagToSuffixHint("E2E"), "e2e");
});

test("tagToSuffixHint('PERF') returns 'performance'", () => {
  assert.equal(tagToSuffixHint("PERF"), "performance");
});

test("tagToSuffixHint('UNKNOWN') returns the lowercased tag (custom-tag fallback)", () => {
  assert.equal(tagToSuffixHint("UNKNOWN"), "unknown");
});

test("tagToSuffixHint roundtrips canonical suffix → tag → suffix", () => {
  for (const suffix of ["regression", "e2e", "sit", "uat", "smoke", "performance"]) {
    const tag = suffixToTag(suffix);
    assert.ok(tag, `suffix ${suffix} should map to a tag`);
    assert.equal(tagToSuffixHint(tag!), suffix, `tag ${tag} should round-trip back to ${suffix}`);
  }
});

// ── tagToSuffix (strict inverse, used by qa_tc_update reconstruction) ──

test("tagToSuffix(undefined) returns undefined", () => {
  assert.equal(tagToSuffix(undefined), undefined);
});

test("tagToSuffix(null) returns undefined", () => {
  assert.equal(tagToSuffix(null), undefined);
});

test("tagToSuffix('') returns undefined (empty string)", () => {
  assert.equal(tagToSuffix(""), undefined);
});

test("tagToSuffix('REG') returns 'regression'", () => {
  assert.equal(tagToSuffix("REG"), "regression");
});

test("tagToSuffix('E2E') returns 'e2e'", () => {
  assert.equal(tagToSuffix("E2E"), "e2e");
});

test("tagToSuffix('SIT') returns 'sit'", () => {
  assert.equal(tagToSuffix("SIT"), "sit");
});

test("tagToSuffix('UAT') returns 'uat'", () => {
  assert.equal(tagToSuffix("UAT"), "uat");
});

test("tagToSuffix('SMOKE') returns 'smoke'", () => {
  assert.equal(tagToSuffix("SMOKE"), "smoke");
});

test("tagToSuffix('PERF') returns 'performance'", () => {
  assert.equal(tagToSuffix("PERF"), "performance");
});

test("tagToSuffix lowercases unknown TAGs (best-effort recovery)", () => {
  assert.equal(tagToSuffix("ACCES"), "acces");
  assert.equal(tagToSuffix("HYPHE"), "hyphe");
});

test("tagToSuffix is case-insensitive on input (canonical TAG matching)", () => {
  assert.equal(tagToSuffix("reg"), "regression");
  assert.equal(tagToSuffix("Reg"), "regression");
});
