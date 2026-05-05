import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "./search";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    rerank: vi.fn(),
    gateway: {
      ...actual.gateway,
      // The unit tests never call into the real gateway — they just need
      // `rerankingModel` to return something `rerank()` (also mocked) can
      // accept without typechecking it.
      rerankingModel: vi.fn((modelId: string) => ({ modelId })),
    },
  };
});

const { rerankHits, rerankMode } = await import("./rerank");
const { rerank, gateway } = await import("ai");

const hit = (id: number, overrides: Partial<SearchHit> = {}): SearchHit => ({
  content: `chunk-${id}`,
  sourcePath: `s${id}.md`,
  headingPath: `Section ${id}`,
  distance: id * 0.1,
  ...overrides,
});

const sampleHits: SearchHit[] = [
  hit(0),
  hit(1),
  hit(2),
  hit(3),
  hit(4),
  hit(5),
];

type RerankRanking = ReadonlyArray<{
  originalIndex: number;
  score: number;
  document: string;
}>;

const stubRanking = (ranking: RerankRanking) => {
  vi.mocked(rerank).mockResolvedValue({
    originalDocuments: sampleHits.map((h) => h.content),
    rerankedDocuments: ranking.map((r) => r.document),
    ranking: [...ranking],
  } as unknown as Awaited<ReturnType<typeof rerank>>);
};

beforeEach(() => {
  vi.mocked(rerank).mockReset();
  vi.mocked(gateway.rerankingModel).mockClear();
  Reflect.deleteProperty(process.env, "CV_CHAT_RERANK");
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(process.env, "CV_CHAT_RERANK");
});

describe("rerankMode", () => {
  it("defaults to on", () => {
    expect(rerankMode()).toBe("on");
  });

  it("respects CV_CHAT_RERANK=off (case-insensitive)", () => {
    process.env.CV_CHAT_RERANK = "OFF";
    expect(rerankMode()).toBe("off");
  });

  it("treats unknown values as on", () => {
    process.env.CV_CHAT_RERANK = "maybe";
    expect(rerankMode()).toBe("on");
  });
});

describe("rerankHits — disabled paths", () => {
  it("returns hits unchanged in pgvector order when CV_CHAT_RERANK=off", async () => {
    process.env.CV_CHAT_RERANK = "off";

    const out = await rerankHits("any query", sampleHits);
    expect(out.map((h) => h.content)).toEqual(sampleHits.map((h) => h.content));
    expect(rerank).not.toHaveBeenCalled();
  });

  it("trims to topN even when rerank is off", async () => {
    process.env.CV_CHAT_RERANK = "off";

    const out = await rerankHits("any", sampleHits, { topN: 3 });
    expect(out).toHaveLength(3);
    expect(out.map((h) => h.content)).toEqual([
      "chunk-0",
      "chunk-1",
      "chunk-2",
    ]);
  });

  it("respects opts.enabled=false to override env=on", async () => {
    process.env.CV_CHAT_RERANK = "on";

    const out = await rerankHits("query", sampleHits, {
      enabled: false,
      topN: 2,
    });
    expect(out).toHaveLength(2);
    expect(rerank).not.toHaveBeenCalled();
  });

  it("returns an empty array when given no hits", async () => {
    process.env.CV_CHAT_RERANK = "on";

    const out = await rerankHits("query", []);
    expect(out).toEqual([]);
    expect(rerank).not.toHaveBeenCalled();
  });
});

describe("rerankHits — gateway success path", () => {
  it("reorders hits by ranking score and attaches rerankScore", async () => {
    process.env.CV_CHAT_RERANK = "on";

    // Gateway returns ranking objects with originalIndex into the documents
    // we sent. Reverse the order so the test verifies we actually use the
    // rerank ordering, not pgvector.
    stubRanking([
      { originalIndex: 5, score: 0.9, document: "chunk-5" },
      { originalIndex: 0, score: 0.7, document: "chunk-0" },
      { originalIndex: 3, score: 0.4, document: "chunk-3" },
    ]);

    const out = await rerankHits("the query", sampleHits, { topN: 3 });

    expect(rerank).toHaveBeenCalledTimes(1);
    const args = vi.mocked(rerank).mock.calls[0][0];
    expect(args.query).toBe("the query");
    expect(args.documents).toEqual(sampleHits.map((h) => h.content));
    expect(args.topN).toBe(3);

    // Default model (cohere/rerank-v3.5) was passed to gateway.rerankingModel.
    expect(gateway.rerankingModel).toHaveBeenCalledWith("cohere/rerank-v3.5");

    expect(out).toHaveLength(3);
    expect(out.map((h) => h.content)).toEqual([
      "chunk-5",
      "chunk-0",
      "chunk-3",
    ]);
    expect(out.map((h) => h.rerankScore)).toEqual([0.9, 0.7, 0.4]);
    // pgvector distance is preserved alongside the rerank score so callers
    // can introspect both signals.
    expect(out[0].distance).toBe(0.5);
  });

  it("threads opts.model through to gateway.rerankingModel", async () => {
    process.env.CV_CHAT_RERANK = "on";
    stubRanking([{ originalIndex: 0, score: 1, document: "chunk-0" }]);

    await rerankHits("q", sampleHits, {
      topN: 1,
      model: "voyage/rerank-2.5",
    });

    expect(gateway.rerankingModel).toHaveBeenCalledWith("voyage/rerank-2.5");
  });

  it("skips out-of-range indices defensively", async () => {
    process.env.CV_CHAT_RERANK = "on";
    stubRanking([
      { originalIndex: 999, score: 0.99, document: "chunk-?" },
      { originalIndex: 1, score: 0.5, document: "chunk-1" },
    ]);

    const out = await rerankHits("q", sampleHits, { topN: 3 });
    expect(out.map((h) => h.content)).toEqual(["chunk-1"]);
  });
});

describe("rerankHits — failure paths", () => {
  it("falls through to pgvector order when rerank() throws", async () => {
    process.env.CV_CHAT_RERANK = "on";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });
    vi.mocked(rerank).mockRejectedValue(new Error("gateway 500"));

    const out = await rerankHits("q", sampleHits, { topN: 3 });
    expect(out.map((h) => h.content)).toEqual([
      "chunk-0",
      "chunk-1",
      "chunk-2",
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/falling back/i)
    );
  });

  it("falls through on an abort/timeout", async () => {
    process.env.CV_CHAT_RERANK = "on";
    vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });
    vi.mocked(rerank).mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );

    const out = await rerankHits("q", sampleHits, { topN: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.content)).toEqual(["chunk-0", "chunk-1"]);
  });
});
