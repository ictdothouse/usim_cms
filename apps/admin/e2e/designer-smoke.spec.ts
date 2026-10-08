import { test, expect } from "@playwright/test";
import { seedDesignerPage } from "./seed";

test("Designer: add element, save, reload, layout persists", async ({ page, context }) => {
  const { pageId, tenantHost, cookieValue, csrfToken } = await seedDesignerPage();

  // The admin's real session lives in an httpOnly cookie, never a bearer
  // token the client can read (see CLAUDE.md's "Session cookie + CSRF
  // migration") — inject the raw cookie value captured by seed.ts directly
  // into the browser context so requests are authenticated as the seeded
  // superadmin without driving the login form.
  await context.addCookies([
    {
      name: "ucms_session",
      value: cookieValue,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);

  // apps/admin/src/lib/api.ts's Session shape / apps/admin/src/App.tsx's
  // SESSION_KEY — seeding this makes the React app render as already
  // logged in on mount instead of showing the login screen. `token` here
  // is the CSRF token (never a bearer secret post-migration). `tenantHost`
  // is set even though POST /api/setup always creates a "superadmin" role
  // user (tenantHost is otherwise null) purely so Shell's `siteHost` state
  // (`useState(session.tenantHost ?? "")`) initializes to our seeded tenant
  // on mount, letting this test deep-link straight to /content/pages/:id
  // instead of driving ContentManager's site picker — a client-side UI
  // hint only, not a security boundary: every real API call still
  // authenticates as the actual superadmin via the cookie above.
  const session = JSON.stringify({
    token: csrfToken,
    role: "superadmin",
    tenantHost,
    tenantHosts: [tenantHost],
  });
  await page.addInitScript((json) => {
    window.localStorage.setItem("usim_cms_session", json);
  }, session);

  await page.goto(`/content/pages/${pageId}`);

  // Add a section (newSection() always seeds it with one empty row/column,
  // see Designer.tsx) then drag a Heading element from the palette into
  // that column — the palette uses native HTML5 drag-and-drop (draggable +
  // onDragStart/onDrop), which Playwright's dragTo() drives via real
  // pointer input the browser translates into actual drag events.
  const addSection = page.getByRole("button", { name: /add section/i });
  await expect(addSection).toBeVisible();
  await addSection.click();

  // Designer.tsx's own canvas <main> is nested inside App.tsx's Shell
  // <main> (two <main> tags in the DOM) — scope to the inner one specifically
  // (its p-6 padding class is unique to it) so canvas-only assertions below
  // can't accidentally match the palette/Shell chrome in the outer <main>.
  const canvas = page.locator("main.p-6");
  await expect(canvas).toBeVisible();

  const column = canvas.locator(".grid > div").first();
  await expect(column).toBeVisible();

  const headingPaletteItem = page.locator('[draggable="true"]', { hasText: "Heading" });
  await expect(headingPaletteItem).toBeVisible();
  await headingPaletteItem.dragTo(column);

  // The canvas now renders the Heading element's default text.
  const canvasHeading = canvas.getByText("Heading", { exact: true });
  await expect(canvasHeading).toBeVisible();

  await page.getByRole("button", { name: /^save draft$/i }).click();
  await expect(page.getByText(/draft saved/i)).toBeVisible({ timeout: 5000 });

  await page.reload();

  await expect(page.locator("main.p-6").getByText("Heading", { exact: true })).toBeVisible();
});

test("Designer: Live Edit drag-to-add creates a new section with the dropped element", async ({ page, context }) => {
  const { pageId, tenantHost, cookieValue, csrfToken } = await seedDesignerPage();

  await context.addCookies([
    {
      name: "ucms_session",
      value: cookieValue,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
  const session = JSON.stringify({
    token: csrfToken,
    role: "superadmin",
    tenantHost,
    tenantHosts: [tenantHost],
  });
  await page.addInitScript((json) => {
    window.localStorage.setItem("usim_cms_session", json);
  }, session);

  await page.goto(`/content/pages/${pageId}`);

  // Live Edit is the default view (see Designer.tsx's own "opens by
  // default" note) — no mode toggle needed. The palette item has no
  // [draggable="true"] attribute in this mode (DesignerPalette.tsx sets
  // draggable={mode !== "live"}), so it's located by its visible text
  // instead, and dragged via a real pointer sequence (mousedown/move/up)
  // rather than Playwright's HTML5-DnD-only dragTo() helper.
  const headingPaletteItem = page.getByText("Heading", { exact: true }).first();
  await expect(headingPaletteItem).toBeVisible();

  const iframe = page.locator('iframe[title="live-view"]');
  await expect(iframe).toBeVisible();
  const box = await iframe.boundingBox();
  if (!box) throw new Error("live-view iframe has no bounding box");

  const start = await headingPaletteItem.boundingBox();
  if (!start) throw new Error("Heading palette item has no bounding box");

  // Drop near the middle of the live-rendered page — an empty page's only
  // content is the "+ Add Section"-equivalent empty state, so any drop
  // point resolves to "new-section".
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  // The drop triggers mutate() -> autosave -> Live Edit reload; the new
  // Heading renders for real inside the iframe once that reload completes.
  await expect(page.frameLocator('iframe[title="live-view"]').getByText("Heading", { exact: true })).toBeVisible({ timeout: 10000 });
});
