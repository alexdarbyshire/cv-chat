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

const { searchCareerHistory } = await import("./search");
const { embedTexts, sha256 } = await import("./embed");

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
});
