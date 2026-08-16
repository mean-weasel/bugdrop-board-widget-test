import "./style.css";

type Mode = "demo" | "ci";
type Viewer = "ada" | "grace";

interface PublicConfig {
  mode: Mode;
  workerUrl: string;
  boardId: string;
  tokenEndpoint: string;
  venueCommit: string;
  configVersion: string;
  venueOrigins: Record<Mode, string>;
}

const params = new URLSearchParams(window.location.search);
const mode = readSelector(params, "mode", ["demo", "ci"], "demo");
const viewer = readSelector(params, "viewer", ["ada", "grace"], "ada");
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) throw new Error("Application root is missing");

app.innerHTML = `
  <header class="site-header">
    <a class="brand" data-mode-link="demo" aria-label="BugDrop Board preview home">
      <span class="brand-mark" aria-hidden="true">B</span>
      <span>BugDrop Board</span>
    </a>
    <span class="environment-badge">Preview venue</span>
  </header>
  <main>
    <section class="hero" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">Embedded request board</p>
        <h1 id="page-title">Help shape what gets built next.</h1>
        <p class="lede">Submit ideas, see their status, and vote as one of two deterministic preview viewers.</p>
      </div>
      <aside class="safety-card" aria-label="Preview safety notice">
        <strong>Preview-only data</strong>
        <span>This venue never connects to staging or production.</span>
      </aside>
    </section>

    <section class="controls" aria-label="Preview controls">
      <div class="control-group">
        <span class="control-label">Board mode</span>
        <nav class="segmented" aria-label="Board mode">
          ${modeLink("demo", "Demo", mode)}
          ${modeLink("ci", "CI", mode)}
        </nav>
      </div>
      <div class="control-group">
        <span class="control-label">Viewing as</span>
        <nav class="segmented" aria-label="Synthetic viewer">
          ${viewerLink("ada", "Ada", mode, viewer)}
          ${viewerLink("grace", "Grace", mode, viewer)}
        </nav>
      </div>
      <p class="identity-note" role="status">Synthetic identity: <strong>${viewer === "ada" ? "Ada Preview" : "Grace Preview"}</strong></p>
    </section>

    <section id="board" class="board-shell" aria-labelledby="board-title" tabindex="-1">
      <div class="board-heading">
        <div>
          <p class="eyebrow">${mode === "demo" ? "Durable evaluator board" : "Serialized automation board"}</p>
          <h2 id="board-title">Requests and ideas</h2>
        </div>
        <span id="build-status" class="build-status">Checking deployment…</span>
      </div>
      <div id="board-mount" aria-live="polite">
        <div class="loading-card" role="status"><span class="spinner" aria-hidden="true"></span> Loading the embedded board…</div>
      </div>
    </section>
  </main>
  <footer>
    <span>Dedicated BugDrop Board preview venue</span>
    <span id="provenance">Configuration pending</span>
  </footer>
`;

void mountBoard();

async function mountBoard(): Promise<void> {
  try {
    const response = await fetch(`/api/config?mode=${mode}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Configuration request failed");
    const config = validateConfig(await response.json());
    configureModeNavigation(config.venueOrigins, viewer);
    const tokenEndpoint = `${config.tokenEndpoint}&viewer=${viewer}`;
    assertTokenEndpoint(tokenEndpoint, mode, viewer);

    const script = document.createElement("script");
    script.src = `${config.workerUrl}/board.js`;
    script.dataset.apiUrl = config.workerUrl;
    script.dataset.boardId = config.boardId;
    script.dataset.tokenEndpoint = tokenEndpoint;
    script.dataset.mountSelector = "#board-mount";
    script.dataset.pollInterval = "1500";
    script.dataset.bugdropBoardLayout = "kanban";
    const stopWatchingForBoard = hideLoadingWhenBoardMounts();
    script.addEventListener(
      "error",
      () => {
        stopWatchingForBoard();
        showLoadError();
      },
      { once: true },
    );
    document.body.append(script);

    setText("#build-status", `Build ${config.venueCommit.slice(0, 7)}`);
    setText(
      "#provenance",
      `Venue ${config.venueCommit.slice(0, 7)} · config ${config.configVersion}`,
    );
  } catch {
    showLoadError();
  }
}

function hideLoadingWhenBoardMounts(): () => void {
  const mount = document.querySelector("#board-mount");
  if (!mount) throw new Error("Board mount is missing");

  const observer = new MutationObserver(() => {
    if (!mount.querySelector("[data-bugdrop-board-root]")) return;
    mount.querySelector(".loading-card")?.remove();
    observer.disconnect();
  });
  observer.observe(mount, { childList: true });
  return () => observer.disconnect();
}

function validateConfig(value: unknown): PublicConfig {
  if (!isRecord(value)) throw new Error("Invalid public configuration");
  const expectedKeys = [
    "boardId",
    "configVersion",
    "mode",
    "tokenEndpoint",
    "venueCommit",
    "venueOrigins",
    "workerUrl",
  ];
  if (Object.keys(value).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("Unexpected public configuration fields");
  }
  if (
    value.mode !== mode ||
    typeof value.boardId !== "string" ||
    value.boardId.length === 0
  ) {
    throw new Error("Invalid board mapping");
  }
  if (
    typeof value.workerUrl !== "string" ||
    new URL(value.workerUrl).protocol !== "https:"
  ) {
    throw new Error("Invalid Worker origin");
  }
  if (new URL(value.workerUrl).origin !== value.workerUrl)
    throw new Error("Worker must be an origin");
  if (
    typeof value.tokenEndpoint !== "string" ||
    value.tokenEndpoint !== `/api/board-token?mode=${mode}` ||
    typeof value.venueCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.venueCommit) ||
    typeof value.configVersion !== "string" ||
    value.configVersion.length === 0
  ) {
    throw new Error("Invalid deployment metadata");
  }
  if (!isRecord(value.venueOrigins)) {
    throw new Error("Invalid venue navigation");
  }
  const venueOriginKeys = Object.keys(value.venueOrigins).sort();
  if (
    venueOriginKeys.join(",") !== "ci,demo" ||
    typeof value.venueOrigins.demo !== "string" ||
    typeof value.venueOrigins.ci !== "string" ||
    !isExactVenueOrigin(value.venueOrigins.demo) ||
    !isExactVenueOrigin(value.venueOrigins.ci) ||
    value.venueOrigins.demo === value.venueOrigins.ci
  ) {
    throw new Error("Invalid venue navigation");
  }
  return value as unknown as PublicConfig;
}

function assertTokenEndpoint(
  value: string,
  selectedMode: Mode,
  selectedViewer: Viewer,
): void {
  const parsed = new URL(value, window.location.origin);
  if (
    parsed.origin !== window.location.origin ||
    parsed.pathname !== "/api/board-token" ||
    parsed.searchParams.getAll("mode").length !== 1 ||
    parsed.searchParams.get("mode") !== selectedMode ||
    parsed.searchParams.getAll("viewer").length !== 1 ||
    parsed.searchParams.get("viewer") !== selectedViewer ||
    [...parsed.searchParams.keys()].some(
      (key) => key !== "mode" && key !== "viewer",
    )
  ) {
    throw new Error("Invalid token endpoint");
  }
}

function readSelector<T extends string>(
  search: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const values = search.getAll(name);
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !allowed.includes(values[0] as T)) {
    throw new Error(`Invalid ${name} selector`);
  }
  return values[0] as T;
}

function modeLink(value: Mode, label: string, selected: Mode): string {
  return `<a data-mode-link="${value}" ${value === selected ? 'aria-current="page"' : ""}>${label}</a>`;
}

function configureModeNavigation(
  origins: Record<Mode, string>,
  selectedViewer: Viewer,
): void {
  for (const targetMode of ["demo", "ci"] as const) {
    const href = `${origins[targetMode]}/?mode=${targetMode}&viewer=${selectedViewer}`;
    document
      .querySelectorAll<HTMLAnchorElement>(`[data-mode-link="${targetMode}"]`)
      .forEach((link) => link.setAttribute("href", href));
  }
}

function viewerLink(
  value: Viewer,
  label: string,
  selectedMode: Mode,
  selected: Viewer,
): string {
  return `<a href="/?mode=${selectedMode}&viewer=${value}" ${value === selected ? 'aria-current="page"' : ""}>${label}</a>`;
}

function showLoadError(): void {
  const mount = document.querySelector("#board-mount");
  if (mount) {
    mount.innerHTML =
      '<div class="error-card" role="alert"><strong>Preview unavailable</strong><span>The embedded board could not be loaded. No production data was contacted.</span></div>';
  }
  setText("#build-status", "Unavailable");
}

function setText(selector: string, text: string): void {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactVenueOrigin(value: string): boolean {
  const parsed = new URL(value);
  const localHttp =
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname);
  return parsed.origin === value && (parsed.protocol === "https:" || localHttp);
}
