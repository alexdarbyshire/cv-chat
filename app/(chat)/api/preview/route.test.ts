import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPreviewCacheForTests,
  GET,
  isHostAllowed,
  normalizeHost,
  parseOgTags,
} from "./route";

const ALLOWLIST = ["alexdarbyshire.com", "github.com", "linkedin.com"] as const;

describe("normalizeHost", () => {
  it("lower-cases and strips www.", () => {
    expect(normalizeHost("https://WWW.Example.COM/path")).toBe("example.com");
  });

  it("returns empty string for invalid input", () => {
    expect(normalizeHost("not a url")).toBe("");
  });
});

describe("isHostAllowed", () => {
  it("matches an exact host", () => {
    expect(isHostAllowed("https://alexdarbyshire.com/blog", ALLOWLIST)).toBe(
      true
    );
  });

  it("matches subdomains as suffix", () => {
    expect(
      isHostAllowed("https://au.linkedin.com/in/alex-darbyshire-au", ALLOWLIST)
    ).toBe(true);
  });

  it("rejects hosts not on the list", () => {
    expect(isHostAllowed("https://evil.test/og", ALLOWLIST)).toBe(false);
  });

  it("does not partially match the suffix (foolinkedin.com is not linkedin.com)", () => {
    expect(isHostAllowed("https://foolinkedin.com/x", ALLOWLIST)).toBe(false);
  });

  it("rejects an unparseable URL", () => {
    expect(isHostAllowed("not-a-url", ALLOWLIST)).toBe(false);
  });
});

describe("parseOgTags", () => {
  it("extracts og:title / og:description / og:image", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Building cv-chat" />
        <meta property="og:description" content="A small RAG chatbot." />
        <meta property="og:image" content="https://example.test/cover.png" />
      </head></html>
    `;
    expect(parseOgTags(html)).toEqual({
      title: "Building cv-chat",
      description: "A small RAG chatbot.",
      image: "https://example.test/cover.png",
    });
  });

  it("falls back to twitter:* when og:* is missing", () => {
    const html = `
      <meta name="twitter:title" content="Twitter Title" />
      <meta name="twitter:description" content="Twitter desc" />
    `;
    expect(parseOgTags(html)).toMatchObject({
      title: "Twitter Title",
      description: "Twitter desc",
    });
  });

  it("falls back to <title> when og:title is missing", () => {
    const html = "<title>Plain title</title>";
    expect(parseOgTags(html)).toMatchObject({ title: "Plain title" });
  });

  it("returns an empty object on truly metadata-free HTML", () => {
    expect(parseOgTags("<html><body><p>no head</p></body></html>")).toEqual({});
  });

  it("clamps overlong values defensively", () => {
    const longText = "a".repeat(500);
    const html = `<meta property="og:description" content="${longText}" />`;
    const parsed = parseOgTags(html);
    expect(parsed.description?.endsWith("…")).toBe(true);
    expect(parsed.description?.length).toBeLessThanOrEqual(401);
  });
});

const HTML_FIXTURE = `
  <html><head>
    <title>Plain</title>
    <meta property="og:title" content="From OG" />
    <meta property="og:description" content="A description from a real-looking page." />
  </head></html>
`;

beforeEach(() => {
  _resetPreviewCacheForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetPreviewCacheForTests();
});

describe("GET /api/preview", () => {
  const requestFor = (url: string | null) => {
    const u = new URL("http://localhost/api/preview");
    if (url !== null) {
      u.searchParams.set("url", url);
    }
    return new Request(u);
  };

  it("returns 400 when url query is missing", async () => {
    const res = await GET(requestFor(null));
    expect(res.status).toBe(400);
  });

  it("returns 404 for hosts not on the allowlist", async () => {
    const res = await GET(requestFor("https://evil.test/post"));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/allowlist/);
  });

  it("fetches, parses, caches og: tags for an allowlisted host", async () => {
    const fetchMock = vi.fn(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(HTML_FIXTURE));
          controller.close();
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const target = "https://alexdarbyshire.com/posts/foo";
    const r1 = await GET(requestFor(target));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("X-Preview-Cache")).toBe("miss");
    expect(await r1.json()).toEqual({
      title: "From OG",
      description: "A description from a real-looking page.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second hit comes from cache; upstream isn't called again.
    const r2 = await GET(requestFor(target));
    expect(r2.status).toBe(200);
    expect(r2.headers.get("X-Preview-Cache")).toBe("hit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when the upstream fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNRESET")))
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress expected warning
    });

    const res = await GET(requestFor("https://github.com/x/y"));
    expect(res.status).toBe(502);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/preview/i));
  });
});
