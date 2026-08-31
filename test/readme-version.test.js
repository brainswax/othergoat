import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncReadmeText } from "../scripts/readme-version.mjs";

const SAMPLE = `
Until this is on the Chrome Web Store, install **0.1.0** from GitHub:

**[Download Other Goats Records 0.1.0](https://github.com/brainswax/othergoat/releases/download/v0.1.0/other-goats-records-0.1.0.zip)**

([0.1.0 release](https://github.com/brainswax/othergoat/releases/tag/v0.1.0) · [All releases](https://github.com/brainswax/othergoat/releases))
`;

describe("syncReadmeText", () => {
  it("rewrites install links to the given version", () => {
    const out = syncReadmeText(SAMPLE, "9.9.9");
    assert.match(out, /install \*\*9\.9\.9\*\*/);
    assert.match(
      out,
      /Download Other Goats Records 9\.9\.9\]\(https:\/\/github.com\/brainswax\/othergoat\/releases\/download\/v9\.9\.9\/other-goats-records-9\.9\.9\.zip\)/,
    );
    assert.match(
      out,
      /\(\[9\.9\.9 release\]\(https:\/\/github.com\/brainswax\/othergoat\/releases\/tag\/v9\.9\.9\)/,
    );
    assert.match(out, /All releases/);
  });
});
