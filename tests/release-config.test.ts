import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type VercelConfig = {
  cleanUrls?: boolean;
  headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }>;
  rewrites?: Array<{ source?: string; destination?: string }>;
};

type WebManifest = {
  id?: string;
  scope?: string;
  icons?: Array<{ src?: string; purpose?: string }>;
};

const readProjectFile = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("production release configuration", () => {
  it("uses Pixi's CSP-safe renderer polyfills without weakening script policy", () => {
    const rendererSource = readProjectFile("src/game/view/PixiGameView.ts");
    const vercel = JSON.parse(readProjectFile("vercel.json")) as VercelConfig;
    const csp = vercel.headers
      ?.flatMap((entry) => entry.headers ?? [])
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(rendererSource).toContain('import "pixi.js/unsafe-eval";');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("routes client-side deep links to the clean application root", () => {
    const vercel = JSON.parse(readProjectFile("vercel.json")) as VercelConfig;

    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.rewrites).toContainEqual({ source: "/(.*)", destination: "/" });
  });

  it("publishes installable icons including a dedicated maskable asset", () => {
    const manifest = JSON.parse(readProjectFile("public/manifest.webmanifest")) as WebManifest;

    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.icons?.some((icon) => icon.src === "/vanta-icon-192.png")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.src === "/vanta-icon-512.png")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.src === "/vanta-maskable-512.png" && icon.purpose === "maskable")).toBe(true);
  });
});
