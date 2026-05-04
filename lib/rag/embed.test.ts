import { embedMany } from "ai";
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

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    embedMany: vi.fn(),
  };
});

const { embedTexts, embedTextsCached, sha256 } = await import("./embed");

const TEST_PREFIX = `__test__/embed-${Date.now()}-${Math.random()}`;
const VECTOR_LEN = 1536;

const fillVector = (val: number) =>
  Array.from({ length: VECTOR_LEN }, () => val);

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

describe("embedTexts", () => {
  beforeEach(() => {
    vi.mocked(embedMany).mockReset();
  });

  it("returns empty for empty input without calling the gateway", async () => {
    expect(await embedTexts([])).toEqual([]);
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("calls embedMany once and returns vectors in input order", async () => {
    const v1 = fillVector(0.1);
    const v2 = fillVector(0.2);
    vi.mocked(embedMany).mockResolvedValue({
      embeddings: [v1, v2],
      values: ["a", "b"],
      usage: { tokens: 4 },
      warnings: [],
    });

    const result = await embedTexts(["a", "b"]);

    expect(result).toEqual([v1, v2]);
    expect(embedMany).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embedMany).mock.calls[0][0]).toMatchObject({
      values: ["a", "b"],
    });
  });
});

describe("embedTextsCached (integration: real DB)", () => {
  const cachedText = `cached-content-${Date.now()}`;
  const cachedVec = fillVector(0.42);

  beforeAll(async () => {
    await db.insert(embeddingTable).values({
      sourcePath: `${TEST_PREFIX}/seed.md`,
      chunkIndex: 0,
      content: cachedText,
      contentHash: sha256(cachedText),
      embedding: cachedVec,
      metadata: {},
    });
  });

  afterAll(async () => {
    await db
      .delete(embeddingTable)
      .where(like(embeddingTable.sourcePath, `${TEST_PREFIX}/%`));
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(embedMany).mockReset();
  });

  it("returns empty for empty input without DB or gateway calls", async () => {
    const r = await embedTextsCached([]);
    expect(r).toEqual({ embeddings: [], hits: 0, misses: 0 });
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("hits the cache when contentHash exists in DB", async () => {
    const r = await embedTextsCached([cachedText]);
    expect(r.hits).toBe(1);
    expect(r.misses).toBe(0);
    expect(r.embeddings[0]).toEqual(cachedVec);
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("only calls the gateway for misses, preserving input order", async () => {
    const novel = `novel-${Date.now()}-${Math.random()}`;
    const novelVec = fillVector(0.7);
    vi.mocked(embedMany).mockResolvedValue({
      embeddings: [novelVec],
      values: [novel],
      usage: { tokens: 1 },
      warnings: [],
    });

    const r = await embedTextsCached([cachedText, novel]);

    expect(r.hits).toBe(1);
    expect(r.misses).toBe(1);
    expect(r.embeddings[0]).toEqual(cachedVec);
    expect(r.embeddings[1]).toEqual(novelVec);
    expect(vi.mocked(embedMany).mock.calls[0][0].values).toEqual([novel]);
  });

  it("dedupes duplicate inputs — one gateway call per unique text", async () => {
    const novel = `dup-${Date.now()}-${Math.random()}`;
    const novelVec = fillVector(0.9);
    vi.mocked(embedMany).mockResolvedValue({
      embeddings: [novelVec],
      values: [novel],
      usage: { tokens: 1 },
      warnings: [],
    });

    const r = await embedTextsCached([novel, novel, novel]);

    expect(r.hits).toBe(2);
    expect(r.misses).toBe(1);
    expect(vi.mocked(embedMany).mock.calls[0][0].values).toEqual([novel]);
    expect(r.embeddings[0]).toEqual(novelVec);
    expect(r.embeddings[1]).toEqual(novelVec);
    expect(r.embeddings[2]).toEqual(novelVec);
  });
});
