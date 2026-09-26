import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("docs languages", () => {
  it("keeps English pages free of CJK prose and requires a Chinese page per area", () => {
    const output = execFileSync(process.execPath, ["scripts/check-languages.mjs"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    expect(output).toContain("language check ok");
  });
});
