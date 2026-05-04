import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeJSON } from "@/lib/resume/schema";

vi.mock("@/lib/resume/generate", () => ({
  generateTailoredResume: vi.fn(),
}));
vi.mock("@/lib/resume/cache", () => ({
  getOrRenderResume: vi.fn(),
}));
vi.mock("@/lib/resume/static-fallback", () => ({
  staticFallbackUrl: vi.fn(),
}));

const { generateTailoredResumeTool } = await import(
  "./generate-tailored-resume"
);
const { generateTailoredResume } = await import("@/lib/resume/generate");
const { getOrRenderResume } = await import("@/lib/resume/cache");
const { staticFallbackUrl } = await import("@/lib/resume/static-fallback");

const guestSession = {
  user: { id: "u", type: "guest", email: null },
  expires: new Date(Date.now() + 60_000).toISOString(),
} as unknown as Session;

const ownerSession = {
  user: { id: "u", type: "regular", email: "owner@example.test" },
  expires: new Date(Date.now() + 60_000).toISOString(),
} as unknown as Session;

const sampleJson: ResumeJSON = {
  name: "Alex Test",
  headline: "Platform engineer · cloud-native",
  summary: "Summary",
  highlights: ["a"],
  roles: [
    {
      title: "Sr",
      company: "Acme",
      period: "2022–now",
      bullets: ["b"],
    },
  ],
  projects: [],
  skills: ["Kubernetes"],
  socials: {},
};

const callExecute = (
  session: Session,
  input: { roleFocus: string; emphasis: string[] }
) => {
  const t = generateTailoredResumeTool({ session });
  if (!t.execute) {
    throw new Error("tool has no execute");
  }
  return t.execute(input, {
    toolCallId: "test",
    messages: [],
  });
};

describe("generateTailoredResumeTool", () => {
  const originalOwner = process.env.OWNER_EMAIL;

  beforeEach(() => {
    vi.mocked(generateTailoredResume).mockReset();
    vi.mocked(getOrRenderResume).mockReset();
    vi.mocked(staticFallbackUrl).mockReset();
  });

  afterEach(() => {
    if (originalOwner === undefined) {
      delete process.env.OWNER_EMAIL;
    } else {
      process.env.OWNER_EMAIL = originalOwner;
    }
  });

  it("returns the cached URL with the resume headline on the happy path", async () => {
    vi.mocked(generateTailoredResume).mockResolvedValue({
      json: sampleJson,
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
      sources: [],
      attempts: 1,
    });
    vi.mocked(getOrRenderResume).mockResolvedValue({
      url: "https://blob.example.test/resume.pdf",
      cached: false,
    });

    const out = await callExecute(guestSession, {
      roleFocus: "Platform engineering",
      emphasis: ["Kubernetes"],
    });

    expect(out).toEqual({
      url: "https://blob.example.test/resume.pdf",
      headline: sampleJson.headline,
      cached: false,
    });
  });

  it("threads owner detection from OWNER_EMAIL through to generation", async () => {
    process.env.OWNER_EMAIL = "owner@example.test";
    vi.mocked(generateTailoredResume).mockResolvedValue({
      json: sampleJson,
      brief: { roleFocus: "x", emphasis: ["y"] },
      sources: [],
      attempts: 1,
    });
    vi.mocked(getOrRenderResume).mockResolvedValue({
      url: "https://blob.example.test/r.pdf",
      cached: true,
    });

    await callExecute(ownerSession, { roleFocus: "x", emphasis: ["y"] });

    expect(vi.mocked(generateTailoredResume).mock.calls[0][0]).toMatchObject({
      isOwner: true,
    });
  });

  it("anonymous session is never owner regardless of OWNER_EMAIL", async () => {
    process.env.OWNER_EMAIL = "owner@example.test";
    vi.mocked(generateTailoredResume).mockResolvedValue({
      json: sampleJson,
      brief: { roleFocus: "x", emphasis: ["y"] },
      sources: [],
      attempts: 1,
    });
    vi.mocked(getOrRenderResume).mockResolvedValue({
      url: "u",
      cached: false,
    });

    await callExecute(guestSession, { roleFocus: "x", emphasis: ["y"] });

    expect(vi.mocked(generateTailoredResume).mock.calls[0][0]).toMatchObject({
      isOwner: false,
    });
  });

  it("falls back to STATIC_RESUME_URL when generation throws", async () => {
    vi.mocked(generateTailoredResume).mockRejectedValue(
      new Error("gateway exploded")
    );
    vi.mocked(staticFallbackUrl).mockReturnValue(
      "https://example.test/static.pdf"
    );

    const out = (await callExecute(guestSession, {
      roleFocus: "x",
      emphasis: ["y"],
    })) as { url?: string; fallback?: boolean; error?: string };

    expect(out.url).toBe("https://example.test/static.pdf");
    expect(out.fallback).toBe(true);
    expect(out.error).toBeDefined();
  });

  it("falls back to STATIC_RESUME_URL when render throws", async () => {
    vi.mocked(generateTailoredResume).mockResolvedValue({
      json: sampleJson,
      brief: { roleFocus: "x", emphasis: ["y"] },
      sources: [],
      attempts: 1,
    });
    vi.mocked(getOrRenderResume).mockRejectedValue(new Error("typst exploded"));
    vi.mocked(staticFallbackUrl).mockReturnValue(
      "https://example.test/static.pdf"
    );

    const out = (await callExecute(guestSession, {
      roleFocus: "x",
      emphasis: ["y"],
    })) as { url?: string; fallback?: boolean };

    expect(out.url).toBe("https://example.test/static.pdf");
    expect(out.fallback).toBe(true);
  });

  it("returns an error-only result when no fallback is configured", async () => {
    vi.mocked(generateTailoredResume).mockRejectedValue(new Error("boom"));
    vi.mocked(staticFallbackUrl).mockReturnValue(undefined);

    const out = (await callExecute(guestSession, {
      roleFocus: "x",
      emphasis: ["y"],
    })) as { url?: string; error?: string };

    expect(out.url).toBeUndefined();
    expect(out.error).toBeDefined();
  });
});
