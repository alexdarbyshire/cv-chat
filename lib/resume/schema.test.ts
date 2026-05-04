import { describe, expect, it } from "vitest";
import {
  type ClaimWithProvenance,
  composeResumeJSON,
  type RawResumeContent,
  type ResumeContent,
  ResumeContentSchema,
  validateResumeBounds,
} from "./schema";

const PORTFOLIO_PROV = {
  sourcePath: "Project_Portfolio.md",
  headingPath: "Career > Platform > Lead",
};
const BLOG_PROV = {
  sourcePath: "all-blog-posts.md",
  headingPath: "Career > Build",
};

const claim = (
  text: string,
  provenance = PORTFOLIO_PROV
): ClaimWithProvenance => ({
  text,
  provenance,
});

const validContent: ResumeContent = {
  headline: "Platform engineer · cloud-native infra",
  summary:
    "Ten+ years across application and infra. Comfortable from kernel-up to UI; the bit I keep coming back to is making teams faster by removing toil.",
  highlights: [
    claim(
      "Delivered Kubernetes platform serving 50+ apps across multiple regions"
    ),
    claim(
      "Cut deployment time from 40m to 4m by re-architecting the build pipeline",
      BLOG_PROV
    ),
  ],
  roles: [
    {
      title: "Senior Platform Engineer",
      company: "Acme",
      period: "2022–present",
      bullets: [
        claim(
          "Owned production Kubernetes cluster and incident response rotation"
        ),
        claim(
          "Migrated legacy services off VM-based deploy onto IaC-managed platform",
          BLOG_PROV
        ),
      ],
    },
  ],
  projects: [
    {
      name: "k3s home lab",
      summary:
        "Bare-metal k3s cluster running Vault, Tidewave, and a Postgres replica",
      url: "https://alexdarbyshire.com/k3s",
    },
  ],
  skills: ["Kubernetes", "Postgres", "Terraform", "TypeScript"],
};

const validRaw: RawResumeContent = validContent;

describe("ResumeContentSchema", () => {
  it("accepts well-formed content within all bounds", () => {
    const r = ResumeContentSchema.safeParse(validContent);
    expect(r.success).toBe(true);
  });

  it("rejects an over-length headline (>80 chars)", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      headline: "x".repeat(81),
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 4 highlights (one-page constraint)", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      highlights: [claim("a"), claim("b"), claim("c"), claim("d"), claim("e")],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an over-length role bullet (>140 chars)", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      roles: [
        {
          ...validContent.roles[0],
          bullets: [claim("x".repeat(141))],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a claim with empty provenance.headingPath", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      highlights: [
        { text: "hi", provenance: { sourcePath: "x.md", headingPath: "" } },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty highlights array (must have at least 1)", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      highlights: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts projects with no URL (url is optional)", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      projects: [{ name: "Project", summary: "Summary" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects more than 20 skills", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      skills: Array.from({ length: 21 }, (_, i) => `skill${i}`),
    });
    expect(r.success).toBe(false);
  });
});

describe("composeResumeJSON", () => {
  it("flattens claims to strings and injects persona identity", () => {
    const json = composeResumeJSON(validContent, {
      name: "Alex Example",
      socials: {
        blog: "https://example.test/blog",
        linkedin: "https://linkedin.test/alex",
      },
    });
    expect(json.name).toBe("Alex Example");
    expect(json.socials.blog).toBe("https://example.test/blog");
    expect(json.socials.linkedin).toBe("https://linkedin.test/alex");
    expect(json.socials.github).toBeUndefined();
    expect(json.headline).toBe(validContent.headline);
    expect(json.skills).toEqual(validContent.skills);
    // Provenance must NOT leak into the renderer payload.
    expect(json.highlights).toEqual([
      validContent.highlights[0].text,
      validContent.highlights[1].text,
    ]);
    expect(json.roles[0].bullets).toEqual([
      validContent.roles[0].bullets[0].text,
      validContent.roles[0].bullets[1].text,
    ]);
    // No `.provenance` anywhere in the rendered shape.
    expect(JSON.stringify(json)).not.toContain("provenance");
  });
});

describe("validateResumeBounds", () => {
  it("accepts compliant raw content and returns a strict ResumeContent", () => {
    const r = validateResumeBounds(validRaw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content.headline).toBe(validContent.headline);
      // Strict schema accepts the result.
      expect(ResumeContentSchema.safeParse(r.content).success).toBe(true);
    }
  });

  it("flags overlong fields with specific violations", () => {
    const r = validateResumeBounds({
      ...validRaw,
      headline: "x".repeat(120),
      summary: "y".repeat(400),
      highlights: [claim("z".repeat(200)), claim("ok highlight")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.match(/headline is 120/))).toBe(true);
      expect(r.violations.some((v) => v.match(/summary is 400/))).toBe(true);
      expect(
        r.violations.some((v) => v.match(/highlight\[0\]\.text is 200/))
      ).toBe(true);
    }
  });

  it("flags too-many highlights and too-many skills", () => {
    const r = validateResumeBounds({
      ...validRaw,
      highlights: [claim("a"), claim("b"), claim("c"), claim("d"), claim("e")],
      skills: Array.from({ length: 25 }, (_, i) => `s${i}`),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.match(/5 highlights/))).toBe(true);
      expect(r.violations.some((v) => v.match(/25 skills/))).toBe(true);
    }
  });

  it("flags empty provenance fields on a claim", () => {
    const r = validateResumeBounds({
      ...validRaw,
      highlights: [
        { text: "hi", provenance: { sourcePath: "x.md", headingPath: " " } },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.violations.some((v) =>
          v.match(/highlight\[0\]\.provenance\.headingPath is empty/)
        )
      ).toBe(true);
    }
  });

  it("drops empty-string and non-http URLs silently (url is optional)", () => {
    const r = validateResumeBounds({
      ...validRaw,
      projects: [
        { name: "P1", summary: "S1", url: "" },
        { name: "P2", summary: "S2", url: "not-a-url" },
        { name: "P3", summary: "S3", url: "ftp://nope" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content.projects[0].url).toBeUndefined();
      expect(r.content.projects[1].url).toBeUndefined();
      expect(r.content.projects[2].url).toBeUndefined();
    }
  });

  it("preserves valid http(s) project URLs", () => {
    const r = validateResumeBounds({
      ...validRaw,
      projects: [{ name: "P", summary: "S", url: "https://example.test/proj" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content.projects[0].url).toBe("https://example.test/proj");
    }
  });

  it("flags empty required strings", () => {
    const r = validateResumeBounds({ ...validRaw, headline: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.match(/headline is empty/))).toBe(true);
    }
  });
});
