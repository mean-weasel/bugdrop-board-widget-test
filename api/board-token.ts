import {
  errorResponse,
  getModeConfig,
  getViewer,
  noStoreJson,
  parseMode,
  parseViewer,
} from "../src/config";
import type { ServerRequest, ServerResponse } from "../src/config";
import { signBoardToken } from "../src/token";

const ALLOWED_QUERY_KEYS = new Set(["mode", "viewer"]);

export async function handleBoardToken(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(405, "Method not allowed", { Allow: "POST" });
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(415, "Content-Type must be application/json");
  }

  const url = new URL(request.url);
  if (
    [...url.searchParams.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))
  ) {
    return errorResponse(400, "Unknown selector");
  }
  if (
    url.searchParams.getAll("mode").length !== 1 ||
    url.searchParams.getAll("viewer").length !== 1
  ) {
    return errorResponse(400, "Exactly one mode and viewer are required");
  }

  const mode = parseMode(url.searchParams.get("mode"));
  const viewer = parseViewer(url.searchParams.get("viewer"));
  if (!mode || !viewer) {
    return errorResponse(400, "Unknown mode or viewer");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be an empty JSON object");
  }
  if (!isEmptyRecord(body)) {
    return errorResponse(400, "Request body must be an empty JSON object");
  }

  try {
    const config = getModeConfig(mode);
    if (
      url.origin !== config.origin ||
      request.headers.get("origin") !== config.origin
    ) {
      return errorResponse(403, "Origin is not allowed");
    }

    const privateJwk = process.env.BOARD_TOKEN_PRIVATE_JWK;
    if (!privateJwk) {
      return errorResponse(503, "Signer is unavailable");
    }
    const token = await signBoardToken(config, getViewer(viewer), privateJwk);
    return noStoreJson({ token }, 200, {
      "Access-Control-Allow-Origin": config.origin,
    });
  } catch {
    return errorResponse(503, "Signer configuration is unavailable");
  }
}

export default async function handler(
  request: ServerRequest,
  response: ServerResponse,
) {
  const webResponse = await handleBoardToken(toRequest(request));
  await writeResponse(response, webResponse);
}

function isEmptyRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).length === 0;
}

function toRequest(request: ServerRequest): Request {
  const protocol =
    request.headers["x-forwarded-proto"] === "http" ? "http" : "https";
  const host = firstHeader(request.headers.host) ?? "invalid.local";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value))
      value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : serializeBody(request.body);
  const init: RequestInit = { method: request.method ?? "GET", headers };
  if (body !== undefined) init.body = body;
  return new Request(
    `${protocol}://${host}${request.url ?? "/api/board-token"}`,
    init,
  );
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function serializeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

async function writeResponse(
  response: ServerResponse,
  source: Response,
): Promise<void> {
  source.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(source.status).send(await source.text());
}
