import {
  errorResponse,
  getModeConfig,
  noStoreJson,
  parseMode,
  publicModeConfig,
} from "../src/config";
import type { ServerRequest, ServerResponse } from "../src/config";

export function handleConfig(request: Request): Response {
  if (request.method !== "GET") {
    return errorResponse(405, "Method not allowed", { Allow: "GET" });
  }
  const url = new URL(request.url);
  if (
    url.searchParams.getAll("mode").length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "mode")
  ) {
    return errorResponse(400, "Exactly one mode selector is required");
  }
  const mode = parseMode(url.searchParams.get("mode"));
  if (!mode) {
    return errorResponse(400, "Unknown mode");
  }
  try {
    return noStoreJson(publicModeConfig(getModeConfig(mode)));
  } catch {
    return errorResponse(503, "Venue configuration is unavailable");
  }
}

export default async function handler(
  request: ServerRequest,
  response: ServerResponse,
) {
  const protocol =
    request.headers["x-forwarded-proto"] === "http" ? "http" : "https";
  const host = firstHeader(request.headers.host) ?? "invalid.local";
  const source = handleConfig(
    new Request(`${protocol}://${host}${request.url ?? "/api/config"}`, {
      method: request.method ?? "GET",
    }),
  );
  source.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(source.status).send(await source.text());
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
