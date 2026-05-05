import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent, ResumeJSON } from "@/lib/resume/schema";
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

const { updateTailoredResumeTool } = await import("./update-tailored-resume");
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

const sampleContent: ResumeContent = {
  headline: sampleJson.headline,
  summary: sampleJson.summary,
  highlights: [
    {
      text: "a",
      provenance: { sourcePath: "x.md", headingPath: "Career > Lead" },
    },
  ],
  roles: [
    {
      title: "Sr",
      company: "Acme",
      period: "2022–now",
      bullets: [
        {
          text: "b",
          provenance: { sourcePath: "x.md", headingPath: "Career > Lead" },
        },
      ],
    },
  ],
  projects: [],
  skills: ["Kubernetes"],
};

const PRIOR_ARTIFACT_ID = "11111111-2222-3333-4444-555555555555";

const mockHappyPath = (url: string, cached = false) => {
  vi.mocked(generateTailoredResume).mockResolvedValue({
    json: sampleJson,
    content: sampleContent,
    brief: { roleFocus: "Platform", emphasis: ["k8s"] },
    sources: [],
    attempts: 1,
    droppedClaims: [],
  });
  vi.mocked(getOrRenderResume).mockResolvedValue({ url, cached });
};

describe("updateTailoredResumeTool", () => {
  beforeEach(() => {
    vi.mocked(generateTailoredResume).mockReset();
    vi.mocked(getOrRenderResume).mockReset();
    vi.mocked(staticFallbackUrl).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-pins the PDF using replaceArtifactId so the artifact pane updates in place", async () => {
    mockHappyPath("https://blob.example.test/v2.pdf");

    const { stream, events } = makeDataStream();
    const t = updateTailoredResumeTool({
      session: guestSession,
      dataStream: stream,
    });
    if (!t.execute) {
      throw new Error("tool has no execute");
    }
    const out = (await t.execute(
      {
        replaceArtifactId: PRIOR_ARTIFACT_ID,
        roleFocus: "Senior platform engineering",
        emphasis: ["Kubernetes", "team leadership"],
      },
      { toolCallId: "test", messages: [] }
    )) as { artifactId?: string; pinned?: boolean; headline?: string };

    expect(out.pinned).toBe(true);
    expect(out.artifactId).toBe(PRIOR_ARTIFACT_ID);
    expect(out.headline).toBe(sampleJson.headline);

    const idEvent = events.find((e) => e.type === "data-id");
    expect(idEvent?.data).toBe(PRIOR_ARTIFACT_ID);
    const pdfEvent = events.find((e) => e.type === "data-pdfArtifact");
    expect(pdfEvent?.data).toBe("https://blob.example.test/v2.pdf");
  });

  it("produces output equivalent to generateTailoredResume on the same brief (apart from artifactId)", async () => {
    mockHappyPath("https://blob.example.test/r.pdf", true);

    const input = {
      roleFocus: "Platform engineering",
      emphasis: ["Kubernetes"],
    };

    const { stream: gStream } = makeDataStream();
    const g = generateTailoredResumeTool({
      session: guestSession,
      dataStream: gStream,
    });
    if (!g.execute) {
      throw new Error("generate tool has no execute");
    }
    const gOut = (await g.execute(input, {
      toolCallId: "test",
      messages: [],
    })) as Record<string, unknown>;

    const { stream: uStream } = makeDataStream();
    const u = updateTailoredResumeTool({
      session: guestSession,
      dataStream: uStream,
    });
    if (!u.execute) {
      throw new Error("update tool has no execute");
    }
    const uOut = (await u.execute(
      { ...input, replaceArtifactId: PRIOR_ARTIFACT_ID },
      { toolCallId: "test", messages: [] }
    )) as Record<string, unknown>;

    const { artifactId: _gId, ...gRest } = gOut;
    const { artifactId: _uId, ...uRest } = uOut;
    expect(uRest).toEqual(gRest);
    expect(uOut.artifactId).toBe(PRIOR_ARTIFACT_ID);
  });

  it("falls back to the static URL when generation throws, keeping the same artifact id", async () => {
    vi.mocked(generateTailoredResume).mockRejectedValue(new Error("boom"));
    vi.mocked(staticFallbackUrl).mockReturnValue(
      "https://example.test/static.pdf"
    );

    const { stream, events } = makeDataStream();
    const t = updateTailoredResumeTool({
      session: guestSession,
      dataStream: stream,
    });
    if (!t.execute) {
      throw new Error("tool has no execute");
    }
    const out = (await t.execute(
      {
        replaceArtifactId: PRIOR_ARTIFACT_ID,
        roleFocus: "x",
        emphasis: ["y"],
      },
      { toolCallId: "test", messages: [] }
    )) as { artifactId?: string; fallback?: boolean; pinned?: boolean };

    expect(out.fallback).toBe(true);
    expect(out.pinned).toBe(true);
    expect(out.artifactId).toBe(PRIOR_ARTIFACT_ID);
    const pdfEvent = events.find((e) => e.type === "data-pdfArtifact");
    expect(pdfEvent?.data).toBe("https://example.test/static.pdf");
  });
});
