import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { staticFallbackUrl } from "./static-fallback";

describe("staticFallbackUrl", () => {
  const original = process.env.STATIC_RESUME_URL;

  beforeEach(() => {
    delete process.env.STATIC_RESUME_URL;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.STATIC_RESUME_URL;
    } else {
      process.env.STATIC_RESUME_URL = original;
    }
  });

  it("returns undefined when env is unset", () => {
    expect(staticFallbackUrl()).toBeUndefined();
  });

  it("returns undefined when env is empty/whitespace", () => {
    process.env.STATIC_RESUME_URL = "   ";
    expect(staticFallbackUrl()).toBeUndefined();
  });

  it("returns the trimmed URL when set", () => {
    process.env.STATIC_RESUME_URL = "  https://example.test/resume.pdf  ";
    expect(staticFallbackUrl()).toBe("https://example.test/resume.pdf");
  });
});
