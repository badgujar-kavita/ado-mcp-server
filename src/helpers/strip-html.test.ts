import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtml } from "./strip-html.ts";

test("converts <br> to newline", () => {
  assert.equal(stripHtml("line1<br>line2"), "line1\nline2");
  assert.equal(stripHtml("line1<br/>line2"), "line1\nline2");
  assert.equal(stripHtml("line1<br />line2"), "line1\nline2");
  assert.equal(stripHtml("line1<BR>line2"), "line1\nline2");
});

test("converts </p> to double newline", () => {
  assert.equal(stripHtml("<p>a</p><p>b</p>"), "a\n\nb");
});

test("converts <li> to dash bullet with space and </li> to newline", () => {
  assert.equal(stripHtml("<ul><li>one</li><li>two</li></ul>"), "- one\n- two");
});

test("converts <h1>-<h6> to ## prefix with double newline suffix", () => {
  assert.equal(stripHtml("<h1>Title</h1>body"), "## Title\n\nbody");
  assert.equal(stripHtml("<h3 class='x'>H3</h3>"), "## H3");
});

test("strips generic tags", () => {
  assert.equal(stripHtml("<span class='x'>hi</span>"), "hi");
  assert.equal(stripHtml("<div><strong>bold</strong></div>"), "bold");
});

test("decodes common HTML entities", () => {
  // Trailing `&nbsp;` becomes a space that .trim() removes.
  assert.equal(stripHtml("&amp; &lt; &gt; &quot; &#39; &nbsp;x"), "& < > \" '  x");
  assert.equal(stripHtml("&amp; &lt; &gt; &quot; &#39;"), "& < > \" '");
});

test("collapses 3+ newlines to 2", () => {
  assert.equal(stripHtml("a\n\n\n\nb"), "a\n\nb");
});

test("trims leading and trailing whitespace", () => {
  assert.equal(stripHtml("   <p>hello</p>   "), "hello");
});

test("currently strips <img> tags entirely (baseline behavior)", () => {
  // This confirms the existing behavior — a later phase will add an option
  // to preserve image markers. Keeping this test locks in the current default.
  assert.equal(stripHtml("before<img src='x.png' alt='diagram' />after"), "beforeafter");
});

test("handles mixed Confluence-like storage markup", () => {
  const input = "<h2>Section</h2><p>This is a <strong>test</strong>.</p><ul><li>a</li><li>b</li></ul>";
  assert.equal(stripHtml(input), "## Section\n\nThis is a test.\n\n- a\n- b");
});
