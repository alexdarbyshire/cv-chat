import { generateObject } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/rag/search";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

vi.mock("@/lib/rag/search", () => ({
  searchCareerHistory: vi.fn(),
  DEFAULT_K: 6,
}));

const { generateTailoredResume, RESUME_RETRIEVAL_K } = await import(
  "./generate"
);
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

const fakeContent = {
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

type AnyMock = ReturnType<typeof vi.mocked<typeof generateObject>>;

describe("generateTailoredResume", () => {
  beforeEach(() => {
    vi.mocked(generateObject).mockReset();
    vi.mocked(searchCareerHistory).mockReset();
    vi.mocked(searchCareerHistory).mockResolvedValue(fakeHits);
    (vi.mocked(generateObject) as unknown as AnyMock).mockResolvedValue({
      object: fakeContent,
    } as never);
  });

  it("retrieves with the larger resume k by default", async () => {
    await generateTailoredResume({
      brief: { roleFocus: "Platform engineering", emphasis: ["Kubernetes"] },
    });

    expect(searchCareerHistory).toHaveBeenCalledTimes(1);
    const call = vi.mocked(searchCareerHistory).mock.calls[0];
    expect(call[1]).toMatchObject({ k: RESUME_RETRIEVAL_K });
  });

  it("composes the search query from roleFocus + emphasis", async () => {
    await generateTailoredResume({
      brief: {
        roleFocus: "Platform engineering",
        emphasis: ["Kubernetes", "Observability"],
      },
    });

    const [query] = vi.mocked(searchCareerHistory).mock.calls[0];
    expect(query).toBe("Platform engineering, Kubernetes, Observability");
  });

  it("threads isOwner through to retrieval", async () => {
    await generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
      isOwner: true,
    });

    const call = vi.mocked(searchCareerHistory).mock.calls[0];
    expect(call[1]).toMatchObject({ isOwner: true });
  });

  it("returns a ResumeJSON with persona identity and source citations", async () => {
    const result = await generateTailoredResume({
      brief: { roleFocus: "Platform", emphasis: ["k8s"] },
    });

    expect(result.json.headline).toBe(fakeContent.headline);
    // name + socials are persona-injected, not from the model.
    expect(typeof result.json.name).toBe("string");
    expect(result.json.name.length).toBeGreaterThan(0);
    expect(result.json.socials).toBeDefined();

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      sourcePath: "Project_Portfolio.md",
      headingPath: "Career > Platform > Lead",
      publicUrl: "https://example.test/portfolio",
    });
  });

  it("propagates the brief into the prompt sent to generateObject", async () => {
    await generateTailoredResume({
      brief: {
        roleFocus: "Platform engineering",
        emphasis: ["Kubernetes", "Observability"],
      },
    });

    const call = vi.mocked(generateObject).mock.calls[0][0] as {
      prompt: string;
    };
    expect(call.prompt).toContain("Platform engineering");
    expect(call.prompt).toContain("Kubernetes");
    expect(call.prompt).toContain("Observability");
    // Sources are interleaved into the prompt for grounding.
    expect(call.prompt).toContain("Project_Portfolio.md");
  });
});
