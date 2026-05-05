import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { embedding as embeddingTable } from "@/lib/db/schema";

vi.mock("./embed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embed")>();
  return {
    ...actual,
    embedTexts: vi.fn(),
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    rerank: vi.fn(),
    gateway: {
      ...actual.gateway,
      rerankingModel: vi.fn((modelId: string) => ({ modelId })),
    },
  };
});

const { searchCareerHistory } = await import("./search");
const { embedTexts, sha256 } = await import("./embed");
const { rerank } = await import("ai");

const VECTOR_LEN = 1536;
const TEST_PREFIX = `__test__/search-${Date.now()}-${Math.random()}`;

const fillVector = (val: number) =>
  Array.from({ length: VECTOR_LEN }, () => val);

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

// Seed vector + query vector are identical so distance is 0 for the two seed
// rows. Real corpus rows have realistic (heterogeneous) embeddings, so they
// land further away than our seeds in cosine space — making the test robust
// against whatever else is currently in the Embedding table.
const SEED_VECTOR = fillVector(1);

describe("searchCareerHistory", () => {
  beforeAll(async () => {
    await db.insert(embeddingTable).values([
      {
        sourcePath: `${TEST_PREFIX}/public.md`,
        chunkIndex: 0,
        content: "PUBLIC seed chunk for owner-filter test",
        contentHash: sha256(`${TEST_PREFIX}-public`),
        embedding: SEED_VECTOR,
        metadata: {
          title: "Public > Section",
          publicUrl: "https://example.test/public",
        },
        public: true,
      },
      {
        sourcePath: `${TEST_PREFIX}/private.md`,
        chunkIndex: 0,
        content: "PRIVATE seed chunk for owner-filter test",
        contentHash: sha256(`${TEST_PREFIX}-private`),
        embedding: SEED_VECTOR,
        metadata: { title: "Private > Section" },
        public: false,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(embeddingTable)
      .where(like(embeddingTable.sourcePath, `${TEST_PREFIX}/%`));
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(embedTexts).mockReset();
    vi.mocked(embedTexts).mockResolvedValue([SEED_VECTOR]);
  });

  it("returns empty without embedding when query is blank", async () => {
    const r = await searchCareerHistory("   ");
    expect(r).toEqual([]);
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("anonymous request returns only public chunks", async () => {
    const hits = await searchCareerHistory("anything", { k: 10 });

    const sources = hits.map((h) => h.sourcePath);
    expect(sources).toContain(`${TEST_PREFIX}/public.md`);
    expect(sources).not.toContain(`${TEST_PREFIX}/private.md`);
  });

  it("owner request returns both public and private chunks", async () => {
    const hits = await searchCareerHistory("anything", {
      k: 10,
      isOwner: true,
    });

    const sources = hits.map((h) => h.sourcePath);
    expect(sources).toContain(`${TEST_PREFIX}/public.md`);
    expect(sources).toContain(`${TEST_PREFIX}/private.md`);
  });

  it("surfaces metadata as headingPath and publicUrl", async () => {
    const hits = await searchCareerHistory("anything", { k: 10 });
    const publicHit = hits.find(
      (h) => h.sourcePath === `${TEST_PREFIX}/public.md`
    );
    expect(publicHit?.headingPath).toBe("Public > Section");
    expect(publicHit?.publicUrl).toBe("https://example.test/public");
  });

  it("rerank=off (default in tests) leaves hits without a rerankScore", async () => {
    const hits = await searchCareerHistory("anything", { k: 10 });
    for (const h of hits) {
      expect(h.rerankScore).toBeUndefined();
    }
  });

  it("rerank=on with a gateway stub reorders hits and attaches rerankScore", async () => {
    // Stub the gateway-brokered rerank: reverse the order so we can assert
    // reranking actually ran (vs. just falling through to pgvector).
    vi.mocked(rerank).mockImplementation(({ documents }) => {
      const docs = documents as string[];
      const ranking = [
        { originalIndex: 1, score: 0.9, document: docs[1] },
        { originalIndex: 0, score: 0.4, document: docs[0] },
      ];
      return Promise.resolve({
        originalDocuments: docs,
        rerankedDocuments: ranking.map((r) => r.document),
        ranking,
      } as Awaited<ReturnType<typeof rerank>>);
    });

    try {
      const hits = await searchCareerHistory("anything", {
        k: 10,
        isOwner: true,
        rerank: true,
        rerankTopN: 2,
      });

      expect(rerank).toHaveBeenCalled();
      expect(hits).toHaveLength(2);
      expect(hits[0].rerankScore).toBe(0.9);
      expect(hits[1].rerankScore).toBe(0.4);
    } finally {
      vi.mocked(rerank).mockReset();
    }
  });
});
