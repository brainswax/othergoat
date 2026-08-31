import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowMatchesQuery } from "../extension/search.js";

describe("rowMatchesQuery", () => {
  it("matches a partial name or registration", () => {
    const parts = ["SG ALDER*GLEN TRES BONNE 3*M", "PN1352104", "3/20/2020"];
    assert.equal(rowMatchesQuery(parts, ""), true);
    assert.equal(rowMatchesQuery(parts, "alder"), true);
    assert.equal(rowMatchesQuery(parts, "135"), true);
    assert.equal(rowMatchesQuery(parts, "pn135"), true);
    assert.equal(rowMatchesQuery(parts, "karamello"), false);
  });

  it("treats spaces as AND and * as a wildcard", () => {
    const parts = ["TWIN WILLOWS AL KARAMELLO", "PD2237546"];
    assert.equal(rowMatchesQuery(parts, "twin kara"), true);
    assert.equal(rowMatchesQuery(parts, "twin*ello"), true);
    assert.equal(rowMatchesQuery(parts, "twin missing"), false);
  });
});
