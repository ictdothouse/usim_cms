import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePairs,
  parseSlides,
  stringifySlides,
  newSlide,
  addSlideElement,
  addSlideRow,
  deleteSlideElement,
  deleteSlideRow,
  updateSlideElementProps,
  updateSlideElementBp,
  parseCards,
  stringifyCards,
} from "./parsers";

test("parsePairs splits on the first pipe, defaults b to '', filters blank lines", () => {
  assert.deepEqual(parsePairs("Q1|A1\n\nno-pipe-line\n"), [{ a: "Q1", b: "A1" }, { a: "no-pipe-line", b: "" }]);
  assert.deepEqual(parsePairs(undefined), []);
});

test("newSlide starts with empty rows (placeholder-only, nothing opt-in yet)", () => {
  const s = newSlide();
  assert.deepEqual(s.rows, []);
  assert.equal(s.imageUrl, "");
  assert.equal(s.bgSize, "");
});

test("addSlideElement appends into the last row, creating one if none exists", () => {
  let s = newSlide();
  s = addSlideElement(s, "heading", { text: "Hi", level: "2", align: "left" });
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].columns[0].elements.length, 1);
  assert.equal(s.rows[0].columns[0].elements[0].type, "heading");
  assert.equal(s.rows[0].columns[0].elements[0].props.text, "Hi");

  s = addSlideRow(s);
  s = addSlideElement(s, "button", { label: "Go", href: "#", variant: "primary", align: "left" });
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].columns[0].elements.length, 1, "first row untouched by the element added after addSlideRow");
  assert.equal(s.rows[1].columns[0].elements[0].type, "button");
});

test("deleteSlideElement/deleteSlideRow remove exactly the targeted node", () => {
  let s = newSlide();
  s = addSlideElement(s, "text", { text: "A", size: "", align: "left" });
  s = addSlideElement(s, "text", { text: "B", size: "", align: "left" });
  s = deleteSlideElement(s, 0, 0, 0);
  assert.equal(s.rows[0].columns[0].elements.length, 1);
  assert.equal(s.rows[0].columns[0].elements[0].props.text, "B");

  s = addSlideRow(s);
  assert.equal(s.rows.length, 2);
  s = deleteSlideRow(s, 0);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].columns[0].elements.length, 0, "the remaining row is the freshly-added empty one");
});

test("updateSlideElementProps merges into one nested element's own props only", () => {
  let s = newSlide();
  s = addSlideElement(s, "text", { text: "A", size: "", align: "left" });
  s = addSlideElement(s, "text", { text: "B", size: "", align: "left" });
  s = updateSlideElementProps(s, 0, 0, 1, { text: "B2" });
  assert.equal(s.rows[0].columns[0].elements[0].props.text, "A");
  assert.equal(s.rows[0].columns[0].elements[1].props.text, "B2");
});

test("updateSlideElementBp replaces (not merges into) one nested element's own bp bag only", () => {
  let s = newSlide();
  s = addSlideElement(s, "text", { text: "A", size: "", align: "left" });
  s = addSlideElement(s, "text", { text: "B", size: "", align: "left" });
  s = updateSlideElementBp(s, 0, 0, 0, { "mobile:text": "A-mobile" });
  assert.deepEqual(s.rows[0].columns[0].elements[0].bp, { "mobile:text": "A-mobile" });
  assert.equal(s.rows[0].columns[0].elements[1].bp, undefined);
  s = updateSlideElementBp(s, 0, 0, 0, undefined);
  assert.equal(s.rows[0].columns[0].elements[0].bp, undefined);
});

test("parseSlides accepts the current rows shape, the legacy heading/subtitle/buttons object shape, and the legacy pipe-line shape", () => {
  const current = parseSlides(JSON.stringify([{ imageUrl: "a.jpg", rows: [] }]));
  assert.equal(current.length, 1);
  assert.equal(current[0].imageUrl, "a.jpg");
  assert.deepEqual(current[0].rows, []);

  // Legacy JSON object shape (pre-rework): heading/subtitle/buttons upgrade
  // into equivalent heading/text/button elements, empty ones contribute
  // nothing (matches today's opt-in default).
  const legacyJson = parseSlides(
    JSON.stringify([
      {
        imageUrl: "a.jpg",
        heading: { text: "H", align: "center" },
        subtitle: "",
        buttons: [{ label: "Click me", href: "https://example.com" }],
      },
    ]),
  );
  assert.equal(legacyJson.length, 1);
  const els = legacyJson[0].rows[0].columns[0].elements;
  assert.equal(els.length, 2, "empty subtitle contributes nothing");
  assert.equal(els[0].type, "heading");
  assert.equal(els[0].props.text, "H");
  assert.equal(els[0].props.align, "center");
  assert.equal(els[1].type, "button");
  assert.equal(els[1].props.label, "Click me");

  const legacyPipe = parseSlides("a.jpg|Heading|Subtitle|Click me|https://example.com");
  assert.equal(legacyPipe.length, 1);
  const pipeEls = legacyPipe[0].rows[0].columns[0].elements;
  assert.equal(pipeEls.length, 3);
  assert.equal(pipeEls[0].type, "heading");
  assert.equal(pipeEls[1].type, "text");
  assert.equal(pipeEls[2].type, "button");

  assert.deepEqual(parseSlides(undefined), []);
});

test("stringifySlides round-trips through parseSlides for the current shape", () => {
  const original = parseSlides(JSON.stringify([{ imageUrl: "x.jpg", rows: [] }]));
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
