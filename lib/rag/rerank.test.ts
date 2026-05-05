import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rerankHits, rerankMode } from "./rerank";
import type { SearchHit } from "./search";

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

const mockFetch = (handler: (url: string, init: RequestInit) => Response) => {
  const fn = vi.fn(async (url: string | URL, init: RequestInit | undefined) =>
    handler(url.toString(), init ?? {})
  );
  vi.stubGlobal("fetch", fn);
  return fn;
};

beforeEach(() => {
  Reflect.deleteProperty(process.env, "CV_CHAT_RERANK");
  Reflect.deleteProperty(process.env, "COHERE_API_KEY");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(process.env, "CV_CHAT_RERANK");
  Reflect.deleteProperty(process.env, "COHERE_API_KEY");
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
    process.env.COHERE_API_KEY = "should-not-matter";
    const fetchMock = mockFetch(() => new Response("nope", { status: 500 }));

    const out = await rerankHits("any query", sampleHits);
    expect(out.map((h) => h.content)).toEqual(sampleHits.map((h) => h.content));
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("falls through to no-rerank with a warning when COHERE_API_KEY is unset", async () => {
    process.env.CV_CHAT_RERANK = "on";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });
    const fetchMock = mockFetch(() => new Response("{}", { status: 200 }));

    const out = await rerankHits("query", sampleHits, { topN: 3 });
    expect(out).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/no provider configured/i)
    );
  });

  it("respects opts.enabled=false to override env=on", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "should-not-matter";
    const fetchMock = mockFetch(() => new Response("{}", { status: 200 }));

    const out = await rerankHits("query", sampleHits, {
      enabled: false,
      topN: 2,
    });
    expect(out).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty array when given no hits", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "key";
    const fetchMock = mockFetch(() => new Response("{}", { status: 200 }));

    const out = await rerankHits("query", []);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rerankHits — Cohere success path", () => {
  it("reorders hits by Cohere relevance_score and attaches rerankScore", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "fake-key";

    const fetchMock = mockFetch(() => {
      // Cohere returns indices into the documents array we sent. Reverse the
      // order so the test verifies we actually use the rerank ordering.
      const results = [
        { index: 5, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.7 },
        { index: 3, relevance_score: 0.4 },
      ];
      return new Response(JSON.stringify({ results }), { status: 200 });
    });

    const out = await rerankHits("the query", sampleHits, { topN: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cohere.com/v2/rerank");
    if (!init) {
      throw new Error("fetch was called without an init argument");
    }
    const body = JSON.parse((init.body ?? "") as string);
    expect(body.query).toBe("the query");
    expect(body.documents).toEqual(sampleHits.map((h) => h.content));
    expect(body.top_n).toBe(3);
    expect(body.model).toMatch(/^rerank-/);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fake-key"
    );

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

  it("skips out-of-range indices defensively", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "fake-key";

    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            results: [
              { index: 999, relevance_score: 0.99 },
              { index: 1, relevance_score: 0.5 },
            ],
          }),
          { status: 200 }
        )
    );

    const out = await rerankHits("q", sampleHits, { topN: 3 });
    expect(out.map((h) => h.content)).toEqual(["chunk-1"]);
  });
});

describe("rerankHits — failure paths", () => {
  it("falls through to pgvector order on HTTP 500", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "fake-key";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });

    mockFetch(() => new Response("boom", { status: 500 }));

    const out = await rerankHits("q", sampleHits, { topN: 3 });
    expect(out.map((h) => h.content)).toEqual([
      "chunk-0",
      "chunk-1",
      "chunk-2",
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cohere rerank 500|falling back/i)
    );
  });

  it("falls through on a network error", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "fake-key";
    vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED")))
    );

    const out = await rerankHits("q", sampleHits, { topN: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.content)).toEqual(["chunk-0", "chunk-1"]);
  });

  it("falls through on malformed JSON from Cohere", async () => {
    process.env.CV_CHAT_RERANK = "on";
    process.env.COHERE_API_KEY = "fake-key";
    vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });

    mockFetch(
      () =>
        new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })
    );

    const out = await rerankHits("q", sampleHits, { topN: 4 });
    expect(out).toHaveLength(4);
    expect(out.map((h) => h.content)).toEqual([
      "chunk-0",
      "chunk-1",
      "chunk-2",
      "chunk-3",
    ]);
  });
});
