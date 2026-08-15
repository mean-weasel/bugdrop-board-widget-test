import {
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { ModeConfig } from "../src/config";
import { getViewer } from "../src/config";
import { publicJwk, signBoardToken } from "../src/token";

const NOW = 1_800_000_000;
const config: ModeConfig = {
  mode: "ci",
  origin: "https://ci.example.test",
  workerUrl: "https://worker.example.test",
  boardId: "board_ci",
  tenantId: "tenant_preview",
  appId: "app_preview",
  issuer: "https://venue.example.test",
  audience: "bugdrop-board",
  keyId: "preview-key-1",
  configVersion: "1",
  venueCommit: "a".repeat(40),
};

let privateJwkText: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateJwkText = JSON.stringify({
    ...(await exportJWK(pair.privateKey)),
    kid: config.keyId,
    alg: "RS256",
  });
});

describe("preview board token signing", () => {
  it("signs an exact five-minute RS256 token for a fixed viewer and board", async () => {
    const token = await signBoardToken(
      config,
      getViewer("ada"),
      privateJwkText,
      NOW,
    );
    const key = await crypto.subtle.importKey(
      "jwk",
      publicJwk(privateJwkText, config.keyId),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const verified = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      audience: config.audience,
      issuer: config.issuer,
      currentDate: new Date(NOW * 1000),
    });

    expect(decodeProtectedHeader(token)).toEqual({
      alg: "RS256",
      kid: config.keyId,
      typ: "JWT",
    });
    expect(verified.payload).toMatchObject({
      sub: "preview_ada",
      externalUserId: "preview_ada",
      displayName: "Ada Preview",
      boardId: config.boardId,
      tenantId: config.tenantId,
      appId: config.appId,
      iat: NOW,
      exp: NOW + 300,
    });
  });

  it("publishes only public RSA fields through JWKS", () => {
    const key = publicJwk(privateJwkText, config.keyId);
    expect(key).toEqual({
      kty: "RSA",
      n: expect.any(String),
      e: expect.any(String),
      use: "sig",
      alg: "RS256",
      kid: config.keyId,
    });
    expect(key).not.toHaveProperty("d");
    expect(key).not.toHaveProperty("p");
    expect(key).not.toHaveProperty("q");
  });

  it("fails closed for a public-only, mismatched, or non-RS256 key", async () => {
    const parsed = JSON.parse(privateJwkText) as Record<string, unknown>;
    await expect(
      signBoardToken(
        config,
        getViewer("ada"),
        JSON.stringify({ kty: "RSA", n: parsed.n, e: parsed.e }),
      ),
    ).rejects.toThrow("private RSA material");
    await expect(
      signBoardToken(
        config,
        getViewer("ada"),
        JSON.stringify({ ...parsed, kid: "wrong-key" }),
      ),
    ).rejects.toThrow("key id");
    await expect(
      signBoardToken(
        config,
        getViewer("ada"),
        JSON.stringify({ ...parsed, alg: "HS256" }),
      ),
    ).rejects.toThrow("algorithm");
  });
});
