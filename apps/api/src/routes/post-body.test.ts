import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePostBodyHtml } from "./collections.js";

// Real BlockNote 0.57 blocksToHTMLLossy output (PostEditorPage's save path).
const editorHtml =
  '<p style="text-align: center;" data-text-alignment="center">centered</p>' +
  '<p style="background-color: #fbf3db; color: #e03e3e;" data-text-color="red" data-background-color="yellow">block colors</p>' +
  '<ul><li style="color: #0b6e99; text-align: center;" data-text-alignment="center" data-text-color="blue"><p class="bn-inline-content">item</p></li></ul>' +
  '<p><span style="background-color: #ddebf1;" data-style-type="backgroundColor" data-value="blue" data-editable="">bg</span>' +
  '<span style="font-family: &quot;Playfair Display&quot;;" data-style-type="font" data-value="Playfair Display" data-editable="">serif</span></p>';

test("a post body keeps the editor's alignment, colors and font", () => {
  const out = sanitizePostBodyHtml(editorHtml);
  assert.match(out, /<p style="text-align:center">centered<\/p>/);
  assert.match(out, /<p style="background-color:#fbf3db;color:#e03e3e">block colors<\/p>/);
  assert.match(out, /<li style="color:#0b6e99;text-align:center">/);
  assert.match(out, /<span style="background-color:#ddebf1">bg<\/span>/);
  assert.match(out, /<span style="font-family:&quot;Playfair Display&quot;">serif<\/span>/);
});

test("a post body drops styles outside the closed shapes", () => {
  const out = sanitizePostBodyHtml(
    '<p style="background-image:url(https://evil.example/x);color:red;position:fixed">a</p>' +
      '<span style="font-family:Calibri">b</span><h2 style="text-align:center" onclick="x()">c</h2>',
  );
  assert.equal(out, "<p>a</p><span>b</span><h2 style=\"text-align:center\">c</h2>");
});
