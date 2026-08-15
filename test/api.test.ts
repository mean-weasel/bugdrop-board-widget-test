import { decodeJwt, exportJWK, generateKeyPair } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { handleBoardToken } from "../api/board-token";
import { handleConfig } from "../api/config";
import { handleHealth } from "../api/health";
import { handleJwks } from "../api/jwks";

const DEMO_ORIGIN = "https://demo.example.test";
const CI_ORIGIN = "https://ci.example.test";
let privateJwkText: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateJwkText = JSON.stringify({
    ...(await exportJWK(pair.privateKey)),
    kid: "preview-key-1",
    alg: "RS256",
  });
});

beforeEach(() => {
  Object.assign(process.env, {
    BUGDROP_BOARD_PREVIEW_WORKER_URL: "https://worker.example.test",
    BUGDROP_BOARD_PREVIEW_TENANT_ID: "tenant_preview",
    BUGDROP_BOARD_PREVIEW_APP_ID: "app_preview",
    BUGDROP_BOARD_PREVIEW_DEMO_BOARD_ID: "board_demo",
    BUGDROP_BOARD_PREVIEW_CI_BOARD_ID: "board_ci",
    BUGDROP_BOARD_PREVIEW_TOKEN_ISSUER: "https://issuer.example.test",
    BUGDROP_BOARD_PREVIEW_TOKEN_AUDIENCE: "bugdrop-board",
    BUGDROP_BOARD_PREVIEW_TOKEN_KID: "preview-key-1",
    BUGDROP_BOARD_VENUE_URL: DEMO_ORIGIN,
    BUGDROP_BOARD_VENUE_PREVIEW_URL: CI_ORIGIN,
    BUGDROP_BOARD_VENUE_CONFIG_VERSION: "test-1",
    VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
    BOARD_TOKEN_PRIVATE_JWK: privateJwkText,
  });
});

describe("POST /api/board-token", () => {
  it("maps fixed selectors and exact origin to server-owned claims", async () => {
    const response = await tokenRequest(
      "mode=ci&viewer=grace",
      CI_ORIGIN,
      "{}",
      CI_ORIGIN,
    );
    const json = (await response.json()) as { token: string };
    const claims = decodeJwt(json.token);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(CI_ORIGIN);
    expect(claims).toMatchObject({
      boardId: "board_ci",
      tenantId: "tenant_preview",
      appId: "app_preview",
      externalUserId: "preview_grace",
      iss: "https://issuer.example.test",
      aud: "bugdrop-board",
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(300);
  });

  it.each([
    ["missing selectors", "", DEMO_ORIGIN],
    ["missing viewer", "mode=demo", DEMO_ORIGIN],
    ["duplicate mode", "mode=demo&mode=ci&viewer=ada", DEMO_ORIGIN],
    ["duplicate viewer", "mode=demo&viewer=ada&viewer=grace", DEMO_ORIGIN],
    ["unknown mode", "mode=staging&viewer=ada", DEMO_ORIGIN],
    ["unknown viewer", "mode=demo&viewer=owner", DEMO_ORIGIN],
    [
      "additional selector",
      "mode=demo&viewer=ada&boardId=production",
      DEMO_ORIGIN,
    ],
  ])("rejects %s", async (_label, query, origin) => {
    expect((await tokenRequest(query, origin)).status).toBe(400);
  });

  it.each([
    ["missing origin", undefined],
    ["null origin", "null"],
    ["attacker origin", "https://attacker.example"],
    [
      "sibling Vercel origin",
      "https://bugdrop-board-widget-test-pr-12.example.vercel.app",
    ],
    ["production Board origin", "https://bugdrop-board.neonwatty.workers.dev"],
    ["mode/origin mismatch", CI_ORIGIN],
  ])("rejects %s", async (_label, origin) => {
    expect((await tokenRequest("mode=demo&viewer=ada", origin)).status).toBe(
      403,
    );
  });

  it("rejects a forged CI Origin header sent through the demo alias", async () => {
    expect(
      (await tokenRequest("mode=ci&viewer=ada", CI_ORIGIN, "{}", DEMO_ORIGIN))
        .status,
    ).toBe(403);
  });

  it("rejects a forged demo Origin header sent through the CI alias", async () => {
    expect(
      (await tokenRequest("mode=demo&viewer=ada", DEMO_ORIGIN, "{}", CI_ORIGIN))
        .status,
    ).toBe(403);
  });

  it("fails closed when demo and CI origins overlap", async () => {
    process.env.BUGDROP_BOARD_VENUE_PREVIEW_URL = DEMO_ORIGIN;
    expect(
      (await tokenRequest("mode=demo&viewer=ada", DEMO_ORIGIN)).status,
    ).toBe(503);
  });

  it("fails closed when demo and CI board ids overlap", async () => {
    process.env.BUGDROP_BOARD_PREVIEW_CI_BOARD_ID = "board_demo";
    expect(
      (await tokenRequest("mode=demo&viewer=ada", DEMO_ORIGIN)).status,
    ).toBe(503);
  });

  it.each([
    ["array", "[]"],
    ["null", "null"],
    ["primitive", "true"],
    ["non-empty", '{"boardId":"board_production"}'],
    ["authority field", '{"ttl":3600}'],
    ["malformed", "{"],
  ])("rejects a %s body", async (_label, body) => {
    expect(
      (await tokenRequest("mode=demo&viewer=ada", DEMO_ORIGIN, body)).status,
    ).toBe(400);
  });

  it("rejects GET with Allow POST and rejects the wrong content type", async () => {
    const get = await handleBoardToken(
      new Request(
        "https://venue.example/api/board-token?mode=demo&viewer=ada",
        {
          headers: { Origin: DEMO_ORIGIN },
        },
      ),
    );
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(get.headers.get("cache-control")).toContain("no-store");

    const wrongType = await handleBoardToken(
      new Request(
        "https://venue.example/api/board-token?mode=demo&viewer=ada",
        {
          method: "POST",
          headers: { Origin: DEMO_ORIGIN, "Content-Type": "text/plain" },
          body: "{}",
        },
      ),
    );
    expect(wrongType.status).toBe(415);
  });

  it("fails closed without signer configuration", async () => {
    delete process.env.BOARD_TOKEN_PRIVATE_JWK;
    expect(
      (await tokenRequest("mode=demo&viewer=ada", DEMO_ORIGIN)).status,
    ).toBe(503);
  });
});

describe("public metadata endpoints", () => {
  it("returns a fixed, redacted mode config", async () => {
    const response = handleConfig(
      new Request("https://venue.example/api/config?mode=demo"),
    );
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(json).toEqual({
      mode: "demo",
      workerUrl: "https://worker.example.test",
      boardId: "board_demo",
      tokenEndpoint: "/api/board-token?mode=demo",
      venueCommit: "b".repeat(40),
      configVersion: "test-1",
      venueOrigins: { demo: DEMO_ORIGIN, ci: CI_ORIGIN },
    });
    expect(JSON.stringify(json)).not.toContain("PRIVATE");
    expect(JSON.stringify(json)).not.toContain("tenant_preview");
  });

  it("fails all public metadata closed for overlapping modes", () => {
    process.env.BUGDROP_BOARD_VENUE_PREVIEW_URL = DEMO_ORIGIN;
    expect(
      handleConfig(new Request("https://venue.example/api/config?mode=demo"))
        .status,
    ).toBe(503);
    expect(
      handleHealth(new Request("https://venue.example/api/health")).status,
    ).toBe(503);
  });

  it("rejects arbitrary, duplicate, and additional config selectors", () => {
    expect(
      handleConfig(
        new Request("https://venue.example/api/config?mode=production"),
      ).status,
    ).toBe(400);
    expect(
      handleConfig(
        new Request("https://venue.example/api/config?mode=demo&mode=ci"),
      ).status,
    ).toBe(400);
    expect(
      handleConfig(
        new Request("https://venue.example/api/config?mode=demo&origin=x"),
      ).status,
    ).toBe(400);
  });

  it("returns redacted health identity and a public-only JWKS", async () => {
    const health = handleHealth(
      new Request("https://venue.example/api/health"),
    );
    expect(await health.json()).toEqual({
      status: "ok",
      service: "bugdrop-board-widget-test",
      venueCommit: "b".repeat(40),
      configVersion: "test-1",
      modes: ["demo", "ci"],
    });
    const jwks = handleJwks(new Request("https://venue.example/api/jwks"));
    const body = (await jwks.json()) as { keys: Record<string, unknown>[] };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      kty: "RSA",
      alg: "RS256",
      kid: "preview-key-1",
    });
    expect(body.keys[0]).not.toHaveProperty("d");
  });
});

function tokenRequest(
  query: string,
  origin?: string,
  body = "{}",
  requestOrigin = DEMO_ORIGIN,
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin !== undefined) headers.set("Origin", origin);
  return handleBoardToken(
    new Request(`${requestOrigin}/api/board-token${query ? `?${query}` : ""}`, {
      method: "POST",
      headers,
      body,
    }),
  );
}
