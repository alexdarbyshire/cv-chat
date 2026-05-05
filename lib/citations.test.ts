import { describe, expect, it } from "vitest";
import {
  type CitationChunkInput,
  citationsFromMessageParts,
  eligibleCitations,
} from "./citations";

const ALLOWLIST = ["alexdarbyshire.com", "github.com", "linkedin.com"] as const;

const chunk = (
  overrides: Partial<CitationChunkInput> = {}
): CitationChunkInput => ({
  publicUrl: "https://alexdarbyshire.com/posts/foo",
  sourcePath: "all-blog-posts.md",
  headingPath: "Career > Build > Why",
  public: true,
  ...overrides,
});

describe("eligibleCitations — Rule 1 (publicUrl required)", () => {
  it("drops chunks with no publicUrl", () => {
    const out = eligibleCitations(
      [chunk(), chunk({ publicUrl: undefined })],
      false,
      ALLOWLIST
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://alexdarbyshire.com/posts/foo");
  });

  it("drops chunks whose publicUrl is just whitespace", () => {
    const out = eligibleCitations(
      [chunk({ publicUrl: "   " })],
      false,
      ALLOWLIST
    );
    expect(out).toEqual([]);
  });
});

describe("eligibleCitations — Rule 2 (owner gate on private chunks)", () => {
  const privateChunk = chunk({
    public: false,
    publicUrl: "https://github.com/alex/private-repo",
  });

  it("hides private chunks from non-owners", () => {
    expect(eligibleCitations([privateChunk], false, ALLOWLIST)).toEqual([]);
  });

  it("renders private chunks for the owner", () => {
    const out = eligibleCitations([privateChunk], true, ALLOWLIST);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://github.com/alex/private-repo");
  });

  it("renders public chunks regardless of isOwner", () => {
    const pub = chunk({
      public: true,
      publicUrl: "https://alexdarbyshire.com/x",
    });
    expect(eligibleCitations([pub], false, ALLOWLIST)).toHaveLength(1);
    expect(eligibleCitations([pub], true, ALLOWLIST)).toHaveLength(1);
  });
});

describe("eligibleCitations — Rule 3 (host allowlist)", () => {
  it("drops chunks whose host isn't on the allowlist", () => {
    const out = eligibleCitations(
      [chunk({ publicUrl: "https://evil.test/post" })],
      false,
      ALLOWLIST
    );
    expect(out).toEqual([]);
  });

  it("permits subdomains of allowlisted hosts", () => {
    const out = eligibleCitations(
      [
        chunk({
          publicUrl: "https://au.linkedin.com/in/alex-darbyshire-au",
        }),
      ],
      false,
      ALLOWLIST
    );
    expect(out).toHaveLength(1);
    expect(out[0].host).toBe("au.linkedin.com");
  });
});

describe("eligibleCitations — labelling + dedupe", () => {
  it("uses headingPath as the chip label, falling back to host", () => {
    const out = eligibleCitations(
      [
        chunk({ headingPath: "Career > Why" }),
        chunk({
          headingPath: undefined,
          publicUrl: "https://github.com/alex/x",
        }),
      ],
      false,
      ALLOWLIST
    );
    expect(out[0].label).toBe("Career > Why");
    expect(out[1].label).toBe("github.com");
  });

  it("dedupes by publicUrl across multiple chunks", () => {
    const out = eligibleCitations(
      [
        chunk({ publicUrl: "https://alexdarbyshire.com/posts/x" }),
        chunk({ publicUrl: "https://alexdarbyshire.com/posts/x" }),
      ],
      false,
      ALLOWLIST
    );
    expect(out).toHaveLength(1);
  });

  it("preserves first-seen order", () => {
    const out = eligibleCitations(
      [
        chunk({ publicUrl: "https://github.com/alex/a" }),
        chunk({ publicUrl: "https://alexdarbyshire.com/posts/b" }),
      ],
      false,
      ALLOWLIST
    );
    expect(out.map((c) => c.url)).toEqual([
      "https://github.com/alex/a",
      "https://alexdarbyshire.com/posts/b",
    ]);
  });
});

describe("citationsFromMessageParts", () => {
  const wrapInPart = (chunks: CitationChunkInput[]) => ({
    type: "tool-searchCareerHistory",
    state: "output-available",
    output: { chunks },
  });

  it("walks message parts and aggregates across multiple search calls", () => {
    const parts = [
      { type: "text", text: "I'll look that up." },
      wrapInPart([chunk({ publicUrl: "https://alexdarbyshire.com/posts/a" })]),
      { type: "text", text: "And another." },
      wrapInPart([
        chunk({ publicUrl: "https://github.com/alex/b" }),
        chunk({ publicUrl: "https://alexdarbyshire.com/posts/a" }), // dupe
      ]),
    ];

    const out = citationsFromMessageParts(parts, false, ALLOWLIST);
    expect(out.map((c) => c.url)).toEqual([
      "https://alexdarbyshire.com/posts/a",
      "https://github.com/alex/b",
    ]);
  });

  it("ignores tool parts whose state isn't output-available yet", () => {
    const parts = [
      {
        type: "tool-searchCareerHistory",
        state: "input-available",
        // Output not yet returned — must NOT be read.
      },
    ];
    expect(citationsFromMessageParts(parts, false, ALLOWLIST)).toEqual([]);
  });

  it("returns [] for undefined parts", () => {
    expect(citationsFromMessageParts(undefined, false, ALLOWLIST)).toEqual([]);
  });
});
