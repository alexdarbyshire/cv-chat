import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeJSON } from "@/lib/resume/schema";
import type { ChatMessage } from "@/lib/types";

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

type StreamEvent = { type: string; data: unknown };

function makeDataStream(): {
  stream: UIMessageStreamWriter<ChatMessage>;
  events: StreamEvent[];
} {
  const events: StreamEvent[] = [];
  const stream = {
    write: (event: { type: string; data: unknown }) => {
      events.push({ type: event.type, data: event.data });
    },
  } as unknown as UIMessageStreamWriter<ChatMessage>;
  return { stream, events };
}

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
  input: { roleFocus: string; emphasis: string[] },
  override?: { stream: UIMessageStreamWriter<ChatMessage> }
) => {
  const { stream, events } = override
    ? { stream: override.stream, events: [] as StreamEvent[] }
    : makeDataStream();
  const t = generateTailoredResumeTool({ session, dataStream: stream });
  if (!t.execute) {
    throw new Error("tool has no execute");
  }
  return {
    result: t.execute(input, {
      toolCallId: "test",
      messages: [],
    }),
    events,
  };
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

  it("pins the rendered PDF to the artifact pane on the happy path", async () => {
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

    const { result, events } = callExecute(guestSession, {
      roleFocus: "Platform engineering",
      emphasis: ["Kubernetes"],
    });
    const out = (await result) as {
      headline?: string;
      cached?: boolean;
      pinned?: boolean;
    };

    expect(out).toEqual({
      headline: sampleJson.headline,
      cached: false,
      pinned: true,
    });

    expect(events.map((e) => e.type)).toEqual([
      "data-kind",
      "data-id",
      "data-title",
      "data-clear",
      "data-pdfArtifact",
      "data-finish",
    ]);
    expect(events[0].data).toBe("pdf");
    expect(events[2].data).toBe("Tailored resume — Platform engineering");
    expect(events[4].data).toBe("https://blob.example.test/resume.pdf");
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

    await callExecute(ownerSession, { roleFocus: "x", emphasis: ["y"] }).result;

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

    await callExecute(guestSession, { roleFocus: "x", emphasis: ["y"] }).result;

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

    const { result, events } = callExecute(guestSession, {
      roleFocus: "x",
      emphasis: ["y"],
    });
    const out = (await result) as {
      fallback?: boolean;
      pinned?: boolean;
      error?: string;
    };

    expect(out.fallback).toBe(true);
    expect(out.pinned).toBe(true);
    expect(out.error).toBeDefined();

    const pdfEvent = events.find((e) => e.type === "data-pdfArtifact");
    expect(pdfEvent?.data).toBe("https://example.test/static.pdf");
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

    const { result, events } = callExecute(guestSession, {
      roleFocus: "x",
      emphasis: ["y"],
    });
    const out = (await result) as { fallback?: boolean; pinned?: boolean };

    expect(out.fallback).toBe(true);
    expect(out.pinned).toBe(true);
    const pdfEvent = events.find((e) => e.type === "data-pdfArtifact");
    expect(pdfEvent?.data).toBe("https://example.test/static.pdf");
  });

  it("returns an error-only result when no fallback is configured", async () => {
    vi.mocked(generateTailoredResume).mockRejectedValue(new Error("boom"));
    vi.mocked(staticFallbackUrl).mockReturnValue(undefined);

    const { result, events } = callExecute(guestSession, {
      roleFocus: "x",
      emphasis: ["y"],
    });
    const out = (await result) as { pinned?: boolean; error?: string };

    expect(out.pinned).toBe(false);
    expect(out.error).toBeDefined();
    expect(events.find((e) => e.type === "data-pdfArtifact")).toBeUndefined();
  });
});
