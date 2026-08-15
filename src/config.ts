export const MODES = ["demo", "ci"] as const;
export const VIEWERS = ["ada", "grace"] as const;

export type VenueMode = (typeof MODES)[number];
export type ViewerId = (typeof VIEWERS)[number];

export interface ModeConfig {
  mode: VenueMode;
  origin: string;
  workerUrl: string;
  boardId: string;
  tenantId: string;
  appId: string;
  issuer: string;
  audience: string;
  keyId: string;
  configVersion: string;
  venueCommit: string;
}

export interface VenueOrigins {
  demo: string;
  ci: string;
}

export interface ViewerConfig {
  id: ViewerId;
  externalUserId: string;
  displayName: string;
  email: string;
}

export interface ServerRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ServerResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ServerResponse;
  send(body: string): void;
}

const VIEWER_CONFIG: Record<ViewerId, ViewerConfig> = {
  ada: {
    id: "ada",
    externalUserId: "preview_ada",
    displayName: "Ada Preview",
    email: "ada-preview@example.invalid",
  },
  grace: {
    id: "grace",
    externalUserId: "preview_grace",
    displayName: "Grace Preview",
    email: "grace-preview@example.invalid",
  },
};

const REQUIRED_SHARED_ENV = {
  workerUrl: "BUGDROP_BOARD_PREVIEW_WORKER_URL",
  tenantId: "BUGDROP_BOARD_PREVIEW_TENANT_ID",
  appId: "BUGDROP_BOARD_PREVIEW_APP_ID",
  issuer: "BUGDROP_BOARD_PREVIEW_TOKEN_ISSUER",
  audience: "BUGDROP_BOARD_PREVIEW_TOKEN_AUDIENCE",
  keyId: "BUGDROP_BOARD_PREVIEW_TOKEN_KID",
  configVersion: "BUGDROP_BOARD_VENUE_CONFIG_VERSION",
} as const;

export function parseMode(value: string | null): VenueMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

export function parseViewer(value: string | null): ViewerId | null {
  return VIEWERS.find((viewer) => viewer === value) ?? null;
}

export function getViewer(viewer: ViewerId): ViewerConfig {
  return VIEWER_CONFIG[viewer];
}

export function getModeConfig(mode: VenueMode): ModeConfig {
  const shared = Object.fromEntries(
    Object.entries(REQUIRED_SHARED_ENV).map(([key, envName]) => [
      key,
      requiredEnv(envName),
    ]),
  ) as unknown as Pick<
    ModeConfig,
    | "workerUrl"
    | "tenantId"
    | "appId"
    | "issuer"
    | "audience"
    | "keyId"
    | "configVersion"
  >;
  const origins = getVenueOrigins();
  const boardIds = {
    demo: requiredEnv("BUGDROP_BOARD_PREVIEW_DEMO_BOARD_ID"),
    ci: requiredEnv("BUGDROP_BOARD_PREVIEW_CI_BOARD_ID"),
  };
  if (boardIds.demo === boardIds.ci) {
    throw new Error("Demo and CI board ids must be distinct");
  }
  const origin = origins[mode];
  const boardId = boardIds[mode];
  const venueCommit = requiredSha("VERCEL_GIT_COMMIT_SHA");

  assertHttpsUrl(origin, "venue origin");
  assertHttpsUrl(shared.workerUrl, "preview Worker URL");
  if (
    new URL(origin).origin !== origin ||
    new URL(shared.workerUrl).origin !== shared.workerUrl
  ) {
    throw new Error(
      "Venue and Worker values must be exact origins without paths",
    );
  }

  return { mode, origin, boardId, venueCommit, ...shared };
}

export function getVenueOrigins(): VenueOrigins {
  const origins = {
    demo: requiredEnv("BUGDROP_BOARD_VENUE_URL"),
    ci: requiredEnv("BUGDROP_BOARD_VENUE_PREVIEW_URL"),
  };
  assertExactOrigin(origins.demo, "demo venue origin");
  assertExactOrigin(origins.ci, "CI venue origin");
  if (origins.demo === origins.ci) {
    throw new Error("Demo and CI venue origins must be distinct");
  }
  return origins;
}

export function publicModeConfig(config: ModeConfig) {
  return {
    mode: config.mode,
    workerUrl: config.workerUrl,
    boardId: config.boardId,
    tokenEndpoint: `/api/board-token?mode=${config.mode}`,
    venueCommit: config.venueCommit,
    configVersion: config.configVersion,
    venueOrigins: getVenueOrigins(),
  };
}

export function noStoreJson(
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Origin");
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  status: number,
  message: string,
  extraHeaders?: HeadersInit,
): Response {
  return noStoreJson({ error: message }, status, extraHeaders);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required deployment configuration: ${name}`);
  }
  return value;
}

function requiredSha(name: string): string {
  const value = requiredEnv(name);
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${name} must be an exact 40-character lowercase Git SHA`);
  }
  return value;
}

function assertHttpsUrl(value: string, label: string): void {
  const parsed = new URL(value);
  const localHttp =
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (
    parsed.protocol !== "https:" &&
    !(process.env.NODE_ENV === "test" && localHttp)
  ) {
    throw new Error(`${label} must use HTTPS`);
  }
}

function assertExactOrigin(value: string, label: string): void {
  assertHttpsUrl(value, label);
  if (new URL(value).origin !== value) {
    throw new Error(`${label} must be an exact origin without a path`);
  }
}
