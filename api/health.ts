import { errorResponse, getModeConfig, noStoreJson } from "../src/config.js";
import type { ServerRequest, ServerResponse } from "../src/config.js";

export function handleHealth(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "Method not allowed", { Allow: "GET, HEAD" });
  }
  try {
    const demo = getModeConfig("demo");
    const ci = getModeConfig("ci");
    const result = noStoreJson({
      status: "ok",
      service: "bugdrop-board-widget-test",
      venueCommit: demo.venueCommit,
      configVersion: demo.configVersion,
      modes: [demo.mode, ci.mode],
    });
    return request.method === "HEAD"
      ? new Response(null, { status: result.status, headers: result.headers })
      : result;
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
  const source = handleHealth(
    new Request(`${protocol}://${host}${request.url ?? "/api/health"}`, {
      method: request.method ?? "GET",
    }),
  );
  source.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(source.status).send(await source.text());
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
