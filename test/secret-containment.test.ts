import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("secret containment", () => {
  it("keeps signer code out of the browser module graph", () => {
    const clientFiles = [
      "src/main.ts",
      "src/style.css",
      "index.html",
      "vite.config.ts",
    ];
    const client = clientFiles
      .map((file) => readFileSync(join(root, file), "utf8"))
      .join("\n");
    expect(client).not.toContain("BOARD_TOKEN_PRIVATE_JWK");
    expect(client).not.toContain("privateJwk");
    expect(client).not.toContain("SignJWT");
    expect(client).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("does not ship private-key markers, token-shaped values, source maps, or token storage", () => {
    if (!existsSync(join(root, "dist"))) return;
    const assets = ["dist/index.html", ...assetPaths()]
      .map((file) => readFileSync(join(root, file), "utf8"))
      .join("\n");
    expect(assets).not.toContain("BOARD_TOKEN_PRIVATE_JWK");
    expect(assets).not.toContain("BEGIN PRIVATE KEY");
    expect(assets).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    expect(assets).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(assetPaths()).not.toContainEqual(expect.stringMatching(/\.map$/));
  });

  it("never logs signed token values in server or client code", () => {
    const files = ["api/board-token.ts", "src/token.ts", "src/main.ts"];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toMatch(
        /console\.(?:log|info|warn|error)\([^)]*token/i,
      );
    }
  });
});

function assetPaths(): string[] {
  const manifest = readFileSync(join(root, "dist/index.html"), "utf8");
  return [...manifest.matchAll(/(?:src|href)="\/?([^"]+)"/g)]
    .map((match) => (match[1] ? `dist/${match[1]}` : undefined))
    .filter((value): value is string =>
      Boolean(value?.startsWith("dist/assets/")),
    );
}
