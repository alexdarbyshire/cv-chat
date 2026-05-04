import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/rag/search";
import type { RawResumeContent } from "./schema";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("@/lib/rag/search", () => ({
  searchCareerHistory: vi.fn(),
  DEFAULT_K: 6,
}));

const {
  generateTailoredResume,
  MAX_RETRIES,
  RESUME_RETRIEVAL_K,
  ResumeBoundsError,
} = await import("./generate");
const { searchCareerHistory } = await import("@/lib/rag/search");

const fakeHits: SearchHit[] = [
  {
    content: "Built and operated a 50-app Kubernetes platform.",
    headingPath: "Career > Platform > Lead",
    sourcePath: "Project_Portfolio.md",
    publicUrl: "https://example.test/portfolio",
    distance: 0.21,
  },
  {
    content: "Cut deploy time from 40m to 4m via pipeline rework.",
    headingPath: "Career > Build",
    sourcePath: "all-blog-posts.md",
    publicUrl: "https://example.test/blog",
    distance: 0.34,
  },
];

const cleanContent: RawResumeContent = {
  headline: "Platform engineer · cloud-native infra",
  summary: "Ten+ years across application and platform.",
  highlights: ["Built a 50-app Kubernetes platform"],
  roles: [
    {
      title: "Senior Platform Engineer",
      company: "Acme",
      period: "2022–present",
      bullets: ["Owned the production cluster"],
    },
  ],
  projects: [{ name: "Pipeline rework", summary: "Cut deploy time 10x" }],
  skills: ["Kubernetes", "Postgres"],
};

const overlongContent: RawResumeContent = {
  ...cleanContent,
  // 280-char max; this is way over.
  summary: "x".repeat(400),
};

type AnyMock = ReturnType<typeof vi.mocked<typeof generateText>>;

function mockOutputs(...outputs: RawResumeContent[]) {
  const mock = vi.mocked(generateText) as unknown as AnyMock;
  for (const out of outputs) {
    mock.mockResolvedValueOnce({ output: out } as never);
  }
}

describe("generateTailoredResume", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    vi.mocked(searchCareerHistory).mockReset();
    vi.mocked(searchCareerHistory).mockResolvedValue(fakeHits);
  });

  it("returns first-pass result when bounds are clean", async () => {
    mockOutputs(cleanContent);
    const r = await generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
    });
    expect(r.attempts).toBe(1);
    expect(r.json.headline).toBe(cleanContent.headline);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("retries with violation feedback when first pass overshoots", async () => {
    mockOutputs(overlongContent, cleanContent);
    const r = await generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
    });
    expect(r.attempts).toBe(2);
    expect(generateText).toHaveBeenCalledTimes(2);

    // Second call should include the prior assistant response + a violations user follow-up.
    const secondCall = vi.mocked(generateText).mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const followup = secondCall.messages.at(-1);
    expect(followup?.role).toBe("user");
    expect(followup?.content).toMatch(/exceeds the limits/i);
    expect(followup?.content).toMatch(/summary is 400 chars/);
  });

  it("throws ResumeBoundsError after MAX_RETRIES retries", async () => {
    // MAX_RETRIES + 1 total attempts, all overlong.
    const all = Array.from({ length: MAX_RETRIES + 1 }, () => overlongContent);
    mockOutputs(...all);
    const promise = generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
    });
    await expect(promise).rejects.toBeInstanceOf(ResumeBoundsError);
    await expect(promise).rejects.toMatchObject({
      violations: expect.arrayContaining([expect.stringMatching(/summary/)]),
    });
    expect(generateText).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("retrieves with RESUME_RETRIEVAL_K and composes the search query from brief", async () => {
    mockOutputs(cleanContent);
    await generateTailoredResume({
      brief: {
        roleFocus: "Platform engineering",
        emphasis: ["Kubernetes", "Observability"],
      },
    });

    expect(searchCareerHistory).toHaveBeenCalledTimes(1);
    const [query, opts] = vi.mocked(searchCareerHistory).mock.calls[0];
    expect(query).toBe("Platform engineering, Kubernetes, Observability");
    expect(opts).toMatchObject({ k: RESUME_RETRIEVAL_K });
  });

  it("threads isOwner through to retrieval", async () => {
    mockOutputs(cleanContent);
    await generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
      isOwner: true,
    });
    const opts = vi.mocked(searchCareerHistory).mock.calls[0][1];
    expect(opts).toMatchObject({ isOwner: true });
  });

  it("composes ResumeJSON with persona identity and surfaces sources", async () => {
    mockOutputs(cleanContent);
    const r = await generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
    });

    expect(typeof r.json.name).toBe("string");
    expect(r.json.name.length).toBeGreaterThan(0);
    expect(r.json.socials).toBeDefined();

    expect(r.sources).toHaveLength(2);
    expect(r.sources[0]).toEqual({
      sourcePath: "Project_Portfolio.md",
      headingPath: "Career > Platform > Lead",
      publicUrl: "https://example.test/portfolio",
    });
  });

  it("interleaves the brief and source chunks into the prompt", async () => {
    mockOutputs(cleanContent);
    await generateTailoredResume({
      brief: {
        roleFocus: "Platform engineering",
        emphasis: ["Kubernetes", "Observability"],
      },
    });
    const call = vi.mocked(generateText).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = call.messages[0].content;
    expect(userPrompt).toContain("Platform engineering");
    expect(userPrompt).toContain("Kubernetes");
    expect(userPrompt).toContain("Observability");
    expect(userPrompt).toContain("Project_Portfolio.md");
  });
});
