/**
 * One-shot Playwright capture for the Sprint 9 deliverable: a screenshot
 * of an assistant message with a citation strip rendered, plus a second
 * shot of the chip's hover popover. Saves to `.tmp/`.
 *
 * Run: `tsx scripts/sprint9-screenshots.ts`. Requires `pnpm dev` running
 * on port 3000 (the same instance Playwright drives in CI).
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const STRIP_PATH = "/workspace/.tmp/sprint9-citations.png";
const POPOVER_PATH = "/workspace/.tmp/sprint9-citation-popover.png";

async function main() {
  await mkdir(dirname(STRIP_PATH), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const input = page.getByTestId("multimodal-input");
  await input.waitFor({ state: "visible", timeout: 60_000 });
  // The textarea is editable once the guest cookie + chat-init plumbing
  // settle — same wait the e2e tests use.
  await page.waitForFunction(
    () => {
      const el = document.querySelector(
        '[data-testid="multimodal-input"]'
      ) as HTMLTextAreaElement | null;
      return Boolean(el && !el.disabled);
    },
    { timeout: 60_000 }
  );
  await input.fill(
    "Tell me about your Azure work and team-leadership experience."
  );

  const sendButton = page.getByTestId("send-button");
  await sendButton.click();

  const strip = page.getByTestId("citation-strip").first();
  await strip.waitFor({ state: "visible", timeout: 120_000 });

  // Let any final streaming + layout settle before capture.
  await page.waitForTimeout(500);

  // Strip screenshot — clip to the first assistant message + a little
  // breathing room above and below.
  const assistant = page.locator("[data-role='assistant']").first();
  const box = await assistant.boundingBox();
  if (!box) {
    throw new Error("could not find assistant message bounding box");
  }
  await page.screenshot({
    path: STRIP_PATH,
    clip: {
      x: Math.max(box.x - 24, 0),
      y: Math.max(box.y - 24, 0),
      width: Math.min(box.width + 48, 1280),
      height: Math.min(box.height + 48, 900),
    },
  });

  // Popover screenshot — hover the first chip until the popover renders,
  // then capture the full viewport.
  const chip = strip.getByTestId("citation-chip").first();
  await chip.hover();
  const popover = page.getByTestId("citation-popover").first();
  await popover.waitFor({ state: "visible", timeout: 5000 });
  // Give /api/preview a moment so the popover shows og: title/description
  // rather than the URL fallback.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: POPOVER_PATH, fullPage: false });

  await browser.close();

  console.log(`wrote ${STRIP_PATH}`);
  console.log(`wrote ${POPOVER_PATH}`);
}

main().catch((error) => {
  console.error("[sprint9-screenshots] fatal:", error);
  process.exit(1);
});
