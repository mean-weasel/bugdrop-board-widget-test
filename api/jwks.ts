import { errorResponse, getModeConfig, noStoreJson } from "../src/config";
import type { ServerRequest, ServerResponse } from "../src/config";
import { publicJwk } from "../src/token";

export function handleJwks(request: Request): Response {
  if (request.method !== "GET") {
    return errorResponse(405, "Method not allowed", { Allow: "GET" });
  }
  try {
    const config = getModeConfig("demo");
    const privateJwk = process.env.BOARD_TOKEN_PRIVATE_JWK;
    if (!privateJwk) {
      return errorResponse(503, "JWKS is unavailable");
    }
    return noStoreJson({ keys: [publicJwk(privateJwk, config.keyId)] });
  } catch {
    return errorResponse(503, "JWKS is unavailable");
  }
}

export default async function handler(
  request: ServerRequest,
  response: ServerResponse,
) {
  const protocol =
    request.headers["x-forwarded-proto"] === "http" ? "http" : "https";
  const host = firstHeader(request.headers.host) ?? "invalid.local";
  const source = handleJwks(
    new Request(`${protocol}://${host}${request.url ?? "/api/jwks"}`, {
      method: request.method ?? "GET",
    }),
  );
  source.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(source.status).send(await source.text());
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
