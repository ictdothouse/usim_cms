import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePairs, parseSlideText, parseSlideButtons, parseSlides, stringifySlides, parseCards, stringifyCards } from "./parsers";

test("parsePairs splits on the first pipe, defaults b to '', filters blank lines", () => {
  assert.deepEqual(parsePairs("Q1|A1\n\nno-pipe-line\n"), [{ a: "Q1", b: "A1" }, { a: "no-pipe-line", b: "" }]);
  assert.deepEqual(parsePairs(undefined), []);
});

test("parseSlideText wraps a legacy string, reads a full object, defaults a garbage input", () => {
  assert.deepEqual(parseSlideText("Hello").text, "Hello");
  const obj = parseSlideText({ text: "Hi", align: "center", fontSize: "20", bp: { "mobile:fontSize": "14" } });
  assert.equal(obj.text, "Hi");
  assert.equal(obj.align, "center");
  assert.equal(obj.fontSize, "20");
  assert.deepEqual(obj.bp, { "mobile:fontSize": "14" });
  assert.equal(parseSlideText(42).text, "");
});

test("parseSlideButtons rejects non-arrays, fills defaults, guards the variant/size enums", () => {
  assert.deepEqual(parseSlideButtons(null), []);
  const [btn] = parseSlideButtons([{ label: "Go", variant: "bogus", size: "xxl" }]);
  assert.equal(btn.label, "Go");
  assert.equal(btn.variant, "primary");
  assert.equal(btn.size, "md");
});

test("parseSlides accepts the JSON shape and the legacy pipe-line shape", () => {
  const jsonForm = parseSlides(JSON.stringify([{ imageUrl: "a.jpg", heading: "H", subtitle: "S", buttons: [] }]));
  assert.equal(jsonForm.length, 1);
  assert.equal(jsonForm[0].imageUrl, "a.jpg");
  assert.equal(jsonForm[0].heading.text, "H");

  const legacyForm = parseSlides("a.jpg|Heading|Subtitle|Click me|https://example.com");
  assert.equal(legacyForm.length, 1);
  assert.equal(legacyForm[0].buttons[0]?.label, "Click me");

  assert.deepEqual(parseSlides(undefined), []);
});

test("stringifySlides round-trips through parseSlides for the JSON shape", () => {
  const original = parseSlides(JSON.stringify([{ imageUrl: "x.jpg", heading: "H1", subtitle: "S1", buttons: [] }]));
  const roundTripped = parseSlides(stringifySlides(original));
  assert.deepEqual(roundTripped, original);
});

test("parseCards fills defaults from a JSON array, rejects garbage/non-arrays", () => {
  const [card] = parseCards(JSON.stringify([{ title: "T", href: "/x" }]));
  assert.equal(card.title, "T");
  assert.equal(card.href, "/x");
  assert.equal(card.image, "");
  assert.equal(card.description, "");
  assert.equal(card.buttonLabel, "");

  assert.deepEqual(parseCards(undefined), []);
  assert.deepEqual(parseCards("not json"), []);
  assert.deepEqual(parseCards(JSON.stringify({ not: "an array" })), []);
});

test("stringifyCards round-trips through parseCards", () => {
  const original = parseCards(JSON.stringify([{ title: "A", image: "a.jpg", description: "D", href: "/a", buttonLabel: "Go" }]));
  const roundTripped = parseCards(stringifyCards(original));
  assert.deepEqual(roundTripped, original);
});
