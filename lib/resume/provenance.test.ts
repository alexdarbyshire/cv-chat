import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/rag/search";
import {
  inventionFeedback,
  provenanceMode,
  stripInventedClaims,
  validateResumeProvenance,
} from "./provenance";
import type { ResumeContent } from "./schema";

const PORTFOLIO = {
  sourcePath: "Project_Portfolio.md",
  headingPath: "Career > Platform > Lead",
};
const BLOG = {
  sourcePath: "all-blog-posts.md",
  headingPath: "Career > Build",
};
const TOPLEVEL = {
  sourcePath: "Profile.md",
  headingPath: "",
};

const hits: SearchHit[] = [
  {
    content: "...",
    sourcePath: PORTFOLIO.sourcePath,
    headingPath: PORTFOLIO.headingPath,
    distance: 0.1,
  },
  {
    content: "...",
    sourcePath: BLOG.sourcePath,
    headingPath: BLOG.headingPath,
    distance: 0.2,
  },
  {
    content: "...",
    sourcePath: TOPLEVEL.sourcePath,
    distance: 0.3,
  },
];

const validContent: ResumeContent = {
  headline: "Headline",
  summary: "Summary text.",
  highlights: [
    { text: "Built a 50-app k8s platform", provenance: PORTFOLIO },
    { text: "Cut deploy time 10x", provenance: BLOG },
  ],
  roles: [
    {
      title: "Sr Engineer",
      company: "Acme",
      period: "2022–now",
      bullets: [
        { text: "Owned the production cluster", provenance: PORTFOLIO },
      ],
    },
  ],
  projects: [],
  skills: ["Kubernetes"],
};

afterEach(() => {
  Reflect.deleteProperty(process.env, "RESUME_PROVENANCE_MODE");
  vi.restoreAllMocks();
});

describe("validateResumeProvenance", () => {
  it("returns ok=true when every claim cites a retrieved chunk", () => {
    const r = validateResumeProvenance(validContent, hits);
    expect(r.ok).toBe(true);
    expect(r.invented).toEqual([]);
  });

  it("flags a highlight citing an unretrieved chunk", () => {
    const bad: ResumeContent = {
      ...validContent,
      highlights: [
        ...validContent.highlights,
        {
          text: "Hallucinated achievement",
          provenance: {
            sourcePath: "fake.md",
            headingPath: "Made > Up > Path",
          },
        },
      ],
    };
    const r = validateResumeProvenance(bad, hits);
    expect(r.ok).toBe(false);
    expect(r.invented).toHaveLength(1);
    expect(r.invented[0]).toMatchObject({
      location: "highlights[2]",
      text: "Hallucinated achievement",
    });
  });

  it("flags an invented role bullet at the right location", () => {
    const bad: ResumeContent = {
      ...validContent,
      roles: [
        {
          ...validContent.roles[0],
          bullets: [
            ...validContent.roles[0].bullets,
            {
              text: "Made-up bullet",
              provenance: { sourcePath: "fake.md", headingPath: "x" },
            },
          ],
        },
      ],
    };
    const r = validateResumeProvenance(bad, hits);
    expect(r.ok).toBe(false);
    expect(r.invented).toHaveLength(1);
    expect(r.invented[0].location).toBe("roles[0].bullets[1]");
  });

  it("accepts a sourcePath-only provenance when the chunk had no headingPath", () => {
    const c: ResumeContent = {
      ...validContent,
      highlights: [
        {
          text: "From the top-of-file chunk",
          provenance: { sourcePath: TOPLEVEL.sourcePath, headingPath: "" },
        },
      ],
    };
    // ResumeContent's strict bound requires non-empty headingPath, so we
    // bypass the parse and call the validator directly with the raw shape —
    // mirrors what the lenient lane does after stripInventedClaims trims.
    const r = validateResumeProvenance(c as unknown as ResumeContent, hits);
    // The sourcePath alone is in the allowed set, so the validator allows it.
    expect(r.ok).toBe(true);
  });

  it("tolerates a model that drops the headingPath when the chunk had one", () => {
    const c: ResumeContent = {
      ...validContent,
      highlights: [
        {
          text: "Cited by sourcePath alone",
          // The chunk had a headingPath but the model omitted it. Allowed.
          provenance: { sourcePath: PORTFOLIO.sourcePath, headingPath: "" },
        },
      ],
    };
    const r = validateResumeProvenance(c as unknown as ResumeContent, hits);
    expect(r.ok).toBe(true);
  });
});

describe("stripInventedClaims", () => {
  it("removes flagged highlights and leaves valid ones", () => {
    const bad: ResumeContent = {
      ...validContent,
      highlights: [
        validContent.highlights[0],
        {
          text: "Bogus",
          provenance: { sourcePath: "fake.md", headingPath: "x" },
        },
      ],
    };
    const r = validateResumeProvenance(bad, hits);
    const trimmed = stripInventedClaims(bad, r.invented);
    expect(trimmed.highlights).toHaveLength(1);
    expect(trimmed.highlights[0].text).toBe("Built a 50-app k8s platform");
  });

  it("removes flagged role bullets and preserves untouched bullets", () => {
    const bad: ResumeContent = {
      ...validContent,
      roles: [
        {
          ...validContent.roles[0],
          bullets: [
            validContent.roles[0].bullets[0],
            {
              text: "Bogus",
              provenance: { sourcePath: "fake.md", headingPath: "x" },
            },
          ],
        },
      ],
    };
    const r = validateResumeProvenance(bad, hits);
    const trimmed = stripInventedClaims(bad, r.invented);
    expect(trimmed.roles[0].bullets).toHaveLength(1);
    expect(trimmed.roles[0].bullets[0].text).toBe(
      "Owned the production cluster"
    );
  });

  it("returns the input unchanged when nothing was flagged", () => {
    const r = stripInventedClaims(validContent, []);
    expect(r).toBe(validContent);
  });
});

describe("inventionFeedback", () => {
  it("includes location, text, and cited paths so the model can rewrite", () => {
    const msg = inventionFeedback([
      {
        location: "highlights[1]",
        text: "Bogus",
        provenance: { sourcePath: "fake.md", headingPath: "Made > Up" },
      },
    ]);
    expect(msg).toMatch(/highlights\[1\]/);
    expect(msg).toMatch(/'fake\.md'/);
    expect(msg).toMatch(/'Made > Up'/);
    expect(msg).toMatch(/cannot invent provenance/i);
  });
});

describe("provenanceMode", () => {
  it("defaults to lenient", () => {
    Reflect.deleteProperty(process.env, "RESUME_PROVENANCE_MODE");
    expect(provenanceMode()).toBe("lenient");
  });

  it("respects RESUME_PROVENANCE_MODE=strict", () => {
    process.env.RESUME_PROVENANCE_MODE = "strict";
    expect(provenanceMode()).toBe("strict");
  });

  it("treats unknown values as lenient", () => {
    process.env.RESUME_PROVENANCE_MODE = "loose";
    expect(provenanceMode()).toBe("lenient");
  });

  it("ignores case", () => {
    process.env.RESUME_PROVENANCE_MODE = "STRICT";
    expect(provenanceMode()).toBe("strict");
  });
});
