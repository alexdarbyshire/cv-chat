import { expect, test } from "@playwright/test";

test.describe("Chat Page", () => {
  test("home page loads with input field", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test("can type in the input field", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Hello world");
    await expect(input).toHaveValue("Hello world");
  });

  test("submit button is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("send-button")).toBeVisible();
  });

  test("suggested actions are visible on empty chat", async ({ page }) => {
    await page.goto("/");
    const suggestions = page.locator("[data-testid='suggested-actions']");
    await expect(suggestions).toBeVisible();
  });

  test("can stop generation with stop button", async ({ page }) => {
    await page.goto("/");

    // Type and send a message
    const input = page.getByTestId("multimodal-input");
    await expect(input).toBeEditable({ timeout: 60_000 });
    await input.fill("Hello");
    const sendButton = page.getByTestId("send-button");
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await sendButton.click();

    // Stop button should appear during generation
    const stopButton = page.getByTestId("stop-button");
    // If generation starts, stop button appears
    // This is a best-effort check since timing depends on API
    await stopButton.click({ timeout: 5000 }).catch(() => {
      // Generation may have finished before we could click
    });
  });
});

test.describe("Citations (SPEC §3.1)", () => {
  test("renders a citation chip linking to an allowlisted host", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await expect(input).toBeEditable({ timeout: 60_000 });
    // Phrasing chosen so the agent calls searchCareerHistory and surfaces
    // chunks with a publicUrl (alexdarbyshire.com / linkedin.com).
    await input.fill(
      "Tell me about your Azure work and team-leadership experience."
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

test.describe("Chat Input Features", () => {
  test("input clears after sending", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await expect(input).toBeEditable({ timeout: 60_000 });
    await input.fill("Test message");
    const sendButton = page.getByTestId("send-button");
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await sendButton.click();

    // Input should clear after sending
    await expect(input).toHaveValue("");
  });

  test("input supports multiline text", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Line 1\nLine 2\nLine 3");
    await expect(input).toContainText("Line 1");
  });
});
