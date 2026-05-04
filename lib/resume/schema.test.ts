import { describe, expect, it } from "vitest";
import {
  composeResumeJSON,
  type ResumeContent,
  ResumeContentSchema,
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

  it("rejects an invalid project URL", () => {
    const r = ResumeContentSchema.safeParse({
      ...validContent,
      projects: [
        {
          name: "Project",
          summary: "Summary",
          url: "not-a-url",
        },
      ],
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
    // content fields preserved
    expect(json.headline).toBe(validContent.headline);
    expect(json.skills).toEqual(validContent.skills);
  });
});
