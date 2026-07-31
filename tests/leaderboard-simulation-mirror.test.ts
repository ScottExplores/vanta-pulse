import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const files = [
  "sim/types.ts",
  "sim/constants.ts",
  "sim/checksum.ts",
  "sim/simulation.ts",
  "sim/replay.ts",
  "content/types.ts",
  "content/builders.ts",
  "content/campaign.ts",
  "content/generated.ts",
  "content/index.ts",
] as const;

const normalizedSource = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    // Deno requires explicit TypeScript extensions; the Vite source does not.
    .replace(/((?:from|export \* from)\s+"[^"]+)\.ts(";)/g, "$1$2")
    // Deno also needs the concrete module where Vite resolves the content barrel.
    .replace(/\.\.\/content\/(?:types|index)(";)/g, "../content$1")
    .trim();

describe("Edge verifier source mirror", () => {
  it.each(files)("keeps %s synchronized with the browser simulation", (file) => {
    const browser = resolve(root, "src/game", file);
    const edge = resolve(
      root,
      "supabase/functions/vanta-pulse-leaderboard/authoritative",
      file,
    );
    expect(normalizedSource(edge)).toBe(normalizedSource(browser));
  });
});
