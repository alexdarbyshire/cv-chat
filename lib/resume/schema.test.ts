import { describe, expect, it } from "vitest";
import {
  composeResumeJSON,
  type RawResumeContent,
  type ResumeContent,
  ResumeContentSchema,
  validateResumeBounds,
} from "./schema";

const validContent: ResumeContent = {
  headline: "Platform engineer · cloud-native infra",
  summary:
    "Ten+ years across application and infra. Comfortable from kernel-up to UI; the bit I keep coming back to is making teams faster by removing toil.",
  highlights: [
    "Delivered Kubernetes platform serving 50+ apps across multiple regions",
    "Cut deployment time from 40m to 4m by re-architecting the build pipeline",
  ],
  roles: [
    {
      title: "Senior Platform Engineer",
      company: "Acme",
      period: "2022–present",
      bullets: [
        "Owned production Kubernetes cluster and incident response rotation",
        "Migrated legacy services off VM-based deploy onto IaC-managed platform",
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
      highlights: ["a", "b", "c", "d", "e"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an over-length role bullet (>140 chars)", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      roles: [
        {
          ...validContent.roles[0],
          bullets: ["x".repeat(141)],
        },
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
  it("injects persona-driven name and socials onto the model output", () => {
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
      highlights: ["z".repeat(200), "ok highlight"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.match(/headline is 120/))).toBe(true);
      expect(r.violations.some((v) => v.match(/summary is 400/))).toBe(true);
      expect(r.violations.some((v) => v.match(/highlight\[0\] is 200/))).toBe(
        true
      );
    }
  });

  it("flags too-many highlights and too-many skills", () => {
    const r = validateResumeBounds({
      ...validRaw,
      highlights: ["a", "b", "c", "d", "e"],
      skills: Array.from({ length: 25 }, (_, i) => `s${i}`),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.match(/5 highlights/))).toBe(true);
      expect(r.violations.some((v) => v.match(/25 skills/))).toBe(true);
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
