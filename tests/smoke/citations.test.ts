import { expect, test } from "@playwright/test";

/**
 * Citation chip strip end-to-end smoke (SPEC §3.1).
 *
 * Whether the strip renders depends on the LLM choosing to call
 * `searchCareerHistory` and on retrieval surfacing at least one chunk
 * with a `publicUrl`. Both are stochastic against the live AI Gateway,
 * which is why this lives in `tests/smoke/` instead of the gate suite —
 * a model that decides to answer without retrieval (or hits a Gateway
 * blip) shouldn't block a merge.
 *
 * The deterministic citation logic — Rule 1 / 2 / 3 enforcement, dedupe,
 * label fallback, allowlist matching, og: parsing, cache — is covered
 * by the vitest cases in `lib/citations.test.ts` and
 * `app/(chat)/api/preview/route.test.ts` (29 cases). This smoke just
 * checks the wiring end-to-end against a real model call.
 *
 * Query phrasing: chosen so any reasonable model will reach for the
 * tool. The chunk-name + corpus-name + entity combination ("EXPERIENCE
 * SECTIONS chunk from your LinkedIn about Robert Bird Group") makes
 * answering without retrieval implausible.
 */

test.describe("Citations (SPEC §3.1) — smoke", () => {
  test("renders a citation chip linking to an allowlisted host", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await expect(input).toBeEditable({ timeout: 60_000 });
    await input.fill(
      "What does the chunk titled EXPERIENCE SECTIONS from your LinkedIn say about Robert Bird Group? Quote it directly — search your career history first."
    );
    const sendButton = page.getByTestId("send-button");
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await sendButton.click();

    const strip = page.getByTestId("citation-strip").first();
    await expect(strip).toBeVisible({ timeout: 90_000 });

    const firstChip = strip.getByTestId("citation-chip").first();
    await expect(firstChip).toBeVisible();

    const href = await firstChip.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toMatch(
      /^https:\/\/(?:[\w-]+\.)?(?:alexdarbyshire\.com|github\.com|linkedin\.com)\b/
    );
    await expect(firstChip).toHaveAttribute("target", "_blank");
    await expect(firstChip).toHaveAttribute("rel", /noopener/);
  });
});
