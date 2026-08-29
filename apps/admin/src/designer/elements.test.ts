// Cross-checks ELS (this app's element schema/field registry) against
// @ucms/element-schema (apps/api's write-time validator, same package
// apps/api/src/collections/validate-layout.ts re-exports) — the two are
// still hand-duplicated tables (see elements.ts's own top-of-file note: a
// single ElementDefinition uniting schema+canvas-render+site-render+
// validator is a bigger design question this test doesn't attempt to
// solve). What this DOES catch: a field added here with a "length"/"color"/
// "select"/"repeater" kind that the validator's matching bucket doesn't
// know about yet — exactly the class of bug CLAUDE.md documents actually
// happening (LENGTH_KEYS missing the bare "padding" key 400'd on the very
// first save of a page using it). Running this at test time turns that
// into a red test instead of a live 400 on someone's first save/publish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ELS } from "./elements";
import { LENGTH_KEYS, COLOR_KEYS, ENUM_VALUES, REPEATER_SCHEMAS } from "@ucms/element-schema";

for (const [type, def] of Object.entries(ELS)) {
  for (const field of def.fields) {
    test(`${type}.${field.key} (${field.kind}) has a matching element-schema bucket`, () => {
      if (field.kind === "length") {
        assert.ok(LENGTH_KEYS.has(field.key), `LENGTH_KEYS is missing "${field.key}"`);
      } else if (field.kind === "color") {
        assert.ok(COLOR_KEYS.has(field.key), `COLOR_KEYS is missing "${field.key}"`);
      } else if (field.kind === "select") {
        assert.ok(ENUM_VALUES[field.key], `ENUM_VALUES is missing "${field.key}"`);
        if (field.options) {
          for (const opt of field.options) {
            assert.ok(
              ENUM_VALUES[field.key].includes(opt),
              `ENUM_VALUES["${field.key}"] is missing option "${opt}" that ${type}.${field.key} offers`,
            );
          }
        }
      } else if (field.kind === "repeater") {
        const schema = REPEATER_SCHEMAS[field.key];
        assert.ok(schema, `REPEATER_SCHEMAS is missing "${field.key}"`);
        const schemaKeys = new Set(schema.map((f) => f.key));
        const uiKeys = new Set((field.itemFields ?? []).map((f) => f.key));
        assert.deepStrictEqual(
          [...uiKeys].sort(),
          [...schemaKeys].sort(),
          `${type}.${field.key} itemFields keys don't match REPEATER_SCHEMAS["${field.key}"] keys`,
        );
      }
    });
  }
}
