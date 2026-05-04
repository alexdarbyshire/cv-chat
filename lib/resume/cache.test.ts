import { list, put } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeJSON } from "./schema";

vi.mock("@vercel/blob", () => ({
  list: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./render", () => ({
  renderResume: vi.fn(),
  TEMPLATE_VERSION: "test-v1",
}));

const { cacheKey, getOrRenderResume } = await import("./cache");
const { renderResume, TEMPLATE_VERSION } = await import("./render");

const sample: ResumeJSON = {
  name: "Alex Test",
  headline: "Platform engineer",
  summary: "Summary text",
  highlights: ["a", "b"],
  roles: [
    {
      title: "Senior",
      company: "Acme",
      period: "2022–now",
      bullets: ["did things", "did more"],
    },
  ],
  projects: [{ name: "p1", summary: "s1" }],
  skills: ["Kubernetes", "Postgres"],
  socials: { linkedin: "https://example.test/li" },
};

describe("cacheKey", () => {
  it("is stable for the same input + version", () => {
    expect(cacheKey(sample, TEMPLATE_VERSION)).toBe(
      cacheKey(sample, TEMPLATE_VERSION)
    );
  });

  it("changes when content changes", () => {
    const a = cacheKey(sample, TEMPLATE_VERSION);
    const b = cacheKey({ ...sample, headline: "Different" }, TEMPLATE_VERSION);
    expect(a).not.toBe(b);
  });

  it("changes when template version changes (forces re-render after layout bump)", () => {
    const a = cacheKey(sample, "1");
    const b = cacheKey(sample, "2");
    expect(a).not.toBe(b);
  });

  it("is insensitive to object key order — content-addressable", () => {
    const reordered: ResumeJSON = {
      socials: sample.socials,
      skills: sample.skills,
      projects: sample.projects,
      roles: sample.roles,
      highlights: sample.highlights,
      summary: sample.summary,
      headline: sample.headline,
      name: sample.name,
    };
    expect(cacheKey(reordered, TEMPLATE_VERSION)).toBe(
      cacheKey(sample, TEMPLATE_VERSION)
    );
  });
});

describe("getOrRenderResume", () => {
  beforeEach(() => {
    vi.mocked(list).mockReset();
    vi.mocked(put).mockReset();
    vi.mocked(renderResume).mockReset();
  });

  it("returns the existing Blob URL on cache hit, no render", async () => {
    const hash = cacheKey(sample, TEMPLATE_VERSION);
    const pathname = `resumes/${hash}.pdf`;
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          url: `https://blob.example.test/${pathname}`,
          downloadUrl: `https://blob.example.test/${pathname}`,
          pathname,
          size: 1234,
          uploadedAt: new Date(),
        },
      ],
      hasMore: false,
    } as never);

    const result = await getOrRenderResume(sample);

    expect(result.cached).toBe(true);
    expect(result.url).toBe(`https://blob.example.test/${pathname}`);
    expect(renderResume).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("renders and uploads on cache miss", async () => {
    vi.mocked(list).mockResolvedValue({
      blobs: [],
      hasMore: false,
    } as never);
    const fakePdf = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    vi.mocked(renderResume).mockResolvedValue(fakePdf);
    vi.mocked(put).mockResolvedValue({
      url: "https://blob.example.test/uploaded.pdf",
      pathname: "resumes/x.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      downloadUrl: "https://blob.example.test/uploaded.pdf",
    } as never);

    const result = await getOrRenderResume(sample);

    expect(result.cached).toBe(false);
    expect(result.url).toBe("https://blob.example.test/uploaded.pdf");
    expect(renderResume).toHaveBeenCalledTimes(1);
    const putCall = vi.mocked(put).mock.calls[0];
    expect(putCall[0]).toBe(
      `resumes/${cacheKey(sample, TEMPLATE_VERSION)}.pdf`
    );
    expect(putCall[1]).toBe(fakePdf);
    expect(putCall[2]).toMatchObject({
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
    });
  });

  it("ignores stray prefix matches that don't equal the exact pathname", async () => {
    const hash = cacheKey(sample, TEMPLATE_VERSION);
    const pathname = `resumes/${hash}.pdf`;
    // list() returns prefix matches — make sure we don't accept a longer name.
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example.test/wrong.pdf",
          downloadUrl: "https://blob.example.test/wrong.pdf",
          pathname: `${pathname}.tmp`,
          size: 1,
          uploadedAt: new Date(),
        },
      ],
      hasMore: false,
    } as never);
    const fakePdf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    vi.mocked(renderResume).mockResolvedValue(fakePdf);
    vi.mocked(put).mockResolvedValue({
      url: "https://blob.example.test/freshly-uploaded.pdf",
      pathname,
      contentType: "application/pdf",
      contentDisposition: "inline",
      downloadUrl: "https://blob.example.test/freshly-uploaded.pdf",
    } as never);

    const result = await getOrRenderResume(sample);

    expect(result.cached).toBe(false);
    expect(renderResume).toHaveBeenCalledTimes(1);
  });
});
