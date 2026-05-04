import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CorpusConfig } from "@/corpus.config";
import { classifyFile, matchPattern, resolveCorpus } from "./ingest";

describe("matchPattern", () => {
  it("matches exact paths", () => {
    expect(matchPattern("foo.md", "foo.md")).toBe(true);
    expect(matchPattern("foo.md", "bar.md")).toBe(false);
  });

  it("supports single-segment * glob", () => {
    expect(matchPattern("foo/*.md", "foo/bar.md")).toBe(true);
    expect(matchPattern("foo/*.md", "foo/bar/baz.md")).toBe(false);
  });

  it("supports recursive ** glob", () => {
    expect(matchPattern("apps/**", "apps/a/b/c.md")).toBe(true);
    expect(matchPattern("apps/**", "apps/x.md")).toBe(true);
    expect(matchPattern("apps/**", "other/x.md")).toBe(false);
  });
});

describe("classifyFile", () => {
  const config: CorpusConfig = {
    denyByDefault: true,
    files: [
      { path: "Public.md", visibility: "public" },
      { path: "applications/**", visibility: "exclude" },
      { path: "linked/*.md", visibility: "exclude" },
    ],
  };

  it("returns public for matching exact entry", () => {
    expect(classifyFile("Public.md", config).visibility).toBe("public");
  });

  it("returns exclude for matching glob", () => {
    expect(classifyFile("applications/foo/bar.md", config).visibility).toBe(
      "exclude"
    );
    expect(classifyFile("linked/x.md", config).visibility).toBe("exclude");
  });

  it("falls back to denyByDefault for unmatched paths", () => {
    expect(classifyFile("Unknown.md", config).visibility).toBe("exclude");
  });

  it("falls back to private when denyByDefault is false", () => {
    expect(
      classifyFile("Unknown.md", { ...config, denyByDefault: false }).visibility
    ).toBe("private");
  });
});

describe("resolveCorpus", () => {
  it("collects supported files, excludes the rest, reports unclassified", async () => {
    const root = await mkdtemp(join(tmpdir(), "cv-chat-corpus-"));
    await writeFile(join(root, "Public.md"), "# Public\nbody\n");
    await writeFile(join(root, "Unknown.md"), "# Unknown\nbody\n");
    await writeFile(join(root, "Excluded.md"), "# Excluded\nbody\n");
    await mkdir(join(root, "apps"));
    await writeFile(join(root, "apps/a.md"), "# A");
    await writeFile(join(root, "skipped.pdf"), "%PDF\n");

    const config: CorpusConfig = {
      denyByDefault: true,
      files: [
        { path: "Public.md", visibility: "public" },
        { path: "Excluded.md", visibility: "exclude" },
        { path: "apps/**", visibility: "exclude" },
      ],
    };

    const { files, unclassified } = await resolveCorpus({
      corpusPath: root,
      config,
    });

    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(["Public.md"]);
    expect(unclassified).toEqual(["Unknown.md"]);
  });
});
