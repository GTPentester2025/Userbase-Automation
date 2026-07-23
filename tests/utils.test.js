const test = require("node:test");
const assert = require("node:assert");
const u = require("../web/pipeline/utils.js");

test("normalizeEmail trims + lowercases; null -> ''", () => {
  assert.equal(u.normalizeEmail("  A@B.Com "), "a@b.com");
  assert.equal(u.normalizeEmail(null), "");
  assert.equal(u.normalizeEmail(undefined), "");
});

test("normalizeId strips trailing .0, whitespace, and thousands commas", () => {
  assert.equal(u.normalizeId("123.0"), "123");
  assert.equal(u.normalizeId(" 12 3 "), "123");
  assert.equal(u.normalizeId(456), "456");
  // SheetJS comma-formatted numeric ID must match the plain-text form
  assert.equal(u.normalizeId("12,345"), u.normalizeId("12345"));
  assert.equal(u.normalizeId("12,345"), "12345");
});

test("normalizeHeader collapses whitespace + casefolds + unescapes", () => {
  assert.equal(u.normalizeHeader("  Employee\nEmail "), "employee email");
  assert.equal(u.normalizeHeader("A&amp;B"), "a&b");
});

test("normalizeValue handles NaN/null -> ''", () => {
  assert.equal(u.normalizeValue(NaN), "");
  assert.equal(u.normalizeValue(null), "");
  assert.equal(u.normalizeValue("  OK  "), "ok");
});

test("resolveColumn matches on normalized header (first wins)", () => {
  assert.equal(
    u.resolveColumn(["Employee\nEmail", "Zone"], "employee email"),
    "Employee\nEmail"
  );
  assert.equal(u.resolveColumn(["Zone"], "Missing"), null);
});

test("extractEmailsFromText finds all", () => {
  assert.deepEqual(u.extractEmailsFromText("a@x.com; b@y.org"), ["a@x.com", "b@y.org"]);
  assert.deepEqual(u.extractEmailsFromText(null), []);
  assert.deepEqual(u.extractEmailsFromText("no emails here"), []);
});
