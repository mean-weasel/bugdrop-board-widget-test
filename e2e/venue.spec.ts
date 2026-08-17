import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Request as PlaywrightRequest } from "@playwright/test";

const COMMIT = "c".repeat(40);
const DEMO_VENUE_ORIGIN = "http://127.0.0.1:4173";
const CI_VENUE_ORIGIN = "http://localhost:4173";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/config?mode=*", async (route) => {
    const mode = new URL(route.request().url()).searchParams.get("mode");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        mode,
        workerUrl: "https://preview-board.invalid",
        boardId: mode === "ci" ? "board_ci" : "board_demo",
        tokenEndpoint: `/api/board-token?mode=${mode}`,
        venueCommit: COMMIT,
        configVersion: "e2e-1",
        venueOrigins: {
          demo: DEMO_VENUE_ORIGIN,
          ci: CI_VENUE_ORIGIN,
        },
      }),
    });
  });
  await page.route("**/api/board-token?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ token: "in-memory-e2e-token" }),
    });
  });
  await page.route("https://preview-board.invalid/board.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        (async () => {
        const current = document.currentScript;
        const tokenResponse = await fetch(current.dataset.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          credentials: 'same-origin',
        });
        const tokenPayload = await tokenResponse.json();
        if (typeof tokenPayload.token !== 'string') throw new Error('Token unavailable');
        const mount = document.querySelector(current.dataset.mountSelector);
        const host = document.createElement('div');
        host.setAttribute('data-bugdrop-board-root', '');
        host.setAttribute('data-test-board-id', current.dataset.boardId);
        host.setAttribute('data-test-token-endpoint', current.dataset.tokenEndpoint);
        host.setAttribute('data-test-layout', current.dataset.layout ?? '');
        host.setAttribute('data-test-composer', current.dataset.composer ?? '');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<section aria-label="Embedded request board"><p>Preview board loaded</p><button type="button">Submit an idea</button></section>';
        mount.append(host);
        })();
      `,
    });
  });
});

test("embeds the fixed demo board for Ada without authority-bearing input", async ({
  page,
}, testInfo) => {
  await page.goto("/?mode=demo&viewer=ada");

  await expect(
    page.getByRole("heading", { name: "Help shape what gets built next." }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic identity:")).toContainText(
    "Ada Preview",
  );
  const host = page.locator("[data-bugdrop-board-root]");
  await expect(host).toHaveAttribute("data-test-board-id", "board_demo");
  await expect(host).toHaveAttribute(
    "data-test-token-endpoint",
    "/api/board-token?mode=demo&viewer=ada",
  );
  await expect(host).toHaveAttribute("data-test-layout", "kanban");
  await expect(host).toHaveAttribute("data-test-composer", "collapsed");
  await expect(host.locator("button")).toHaveAccessibleName("Submit an idea");
  await expect(page.getByText("Loading the embedded board…")).toBeHidden();
  await expect(page.getByText("Build ccccccc")).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations,
    `${testInfo.project.name} accessibility violations`,
  ).toEqual([]);
});

test("switches only between the fixed CI viewer mappings", async ({ page }) => {
  await page.goto("/?mode=ci&viewer=grace");
  await expect(page.getByText("Synthetic identity:")).toContainText(
    "Grace Preview",
  );
  const host = page.locator("[data-bugdrop-board-root]");
  await expect(host).toHaveAttribute("data-test-board-id", "board_ci");
  await expect(host).toHaveAttribute(
    "data-test-token-endpoint",
    "/api/board-token?mode=ci&viewer=grace",
  );
  await expect(page.getByRole("link", { name: "CI" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Grace" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("mode switching reaches the fixed alias and posts one empty token request", async ({
  page,
}) => {
  const tokenRequests: PlaywrightRequest[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/board-token") {
      tokenRequests.push(request);
    }
  });

  await page.goto("/?mode=demo&viewer=ada");
  await expect(page.locator("[data-bugdrop-board-root]")).toBeVisible();
  expect(tokenRequests).toHaveLength(1);
  tokenRequests.length = 0;

  await page.getByRole("link", { name: "CI" }).click();
  await expect(page).toHaveURL(`${CI_VENUE_ORIGIN}/?mode=ci&viewer=ada`);
  await expect(page.locator("[data-bugdrop-board-root]")).toBeVisible();

  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0]?.method()).toBe("POST");
  expect(tokenRequests[0]?.postData()).toBe("{}");
  expect(tokenRequests[0]?.headers()["content-type"]).toBe("application/json");
});
