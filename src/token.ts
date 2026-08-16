import { SignJWT, importJWK, type JWK } from "jose";

import type { ModeConfig, ViewerConfig } from "./config.js";

const TOKEN_TTL_SECONDS = 300;

export async function signBoardToken(
  config: ModeConfig,
  viewer: ViewerConfig,
  privateJwkText: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const privateJwk = parsePrivateJwk(privateJwkText, config.keyId);
  const key = await importJWK(privateJwk, "RS256");

  return new SignJWT({
    tenantId: config.tenantId,
    appId: config.appId,
    boardId: config.boardId,
    externalUserId: viewer.externalUserId,
    displayName: viewer.displayName,
    email: viewer.email,
  })
    .setProtectedHeader({ alg: "RS256", kid: config.keyId, typ: "JWT" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(viewer.externalUserId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + TOKEN_TTL_SECONDS)
    .sign(key);
}

export function publicJwk(privateJwkText: string, expectedKeyId: string): JWK {
  const jwk = parsePrivateJwk(privateJwkText, expectedKeyId);
  return {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    use: "sig",
    alg: "RS256",
    kid: expectedKeyId,
  };
}

function parsePrivateJwk(
  value: string,
  expectedKeyId: string,
): JWK & { n: string; e: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Signing key configuration is invalid");
  }

  if (
    !isRecord(parsed) ||
    parsed.kty !== "RSA" ||
    typeof parsed.n !== "string"
  ) {
    throw new Error("Signing key must be an RSA private JWK");
  }
  if (typeof parsed.e !== "string" || typeof parsed.d !== "string") {
    throw new Error("Signing key must contain private RSA material");
  }
  if (parsed.alg !== undefined && parsed.alg !== "RS256") {
    throw new Error("Signing key algorithm must be RS256");
  }
  if (parsed.kid !== undefined && parsed.kid !== expectedKeyId) {
    throw new Error("Signing key id does not match deployment configuration");
  }
  return parsed as JWK & { n: string; e: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
