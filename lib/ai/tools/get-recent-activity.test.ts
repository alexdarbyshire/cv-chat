import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/persona", () => ({
  persona: {
    socials: {
      github: "https://github.com/testuser",
      blog: "https://test.example/",
    },
  },
}));

const { getRecentActivityTool, __internal } = await import(
  "./get-recent-activity"
);

const sampleEvents = [
  {
    id: "1",
    type: "PushEvent",
    repo: { name: "testuser/repo-a" },
    created_at: "2026-05-04T12:00:00Z",
    payload: {
      ref: "refs/heads/main",
      commits: [{ message: "Add a thing\n\nbody" }, { message: "Fix" }],
    },
  },
  {
    id: "2",
    type: "PullRequestEvent",
    repo: { name: "testuser/repo-b" },
    created_at: "2026-05-04T11:00:00Z",
    payload: {
      action: "opened",
      number: 7,
      pull_request: {
        title: "Wire up X",
        html_url: "https://github.com/testuser/repo-b/pull/7",
      },
    },
  },
  {
    id: "3",
    type: "WatchEvent",
    repo: { name: "testuser/repo-c" },
    created_at: "2026-05-04T10:00:00Z",
    payload: {},
  },
  {
    id: "4",
    type: "CreateEvent",
    repo: { name: "testuser/repo-a" },
    created_at: "2026-05-04T09:00:00Z",
    payload: { ref: "feat/x", ref_type: "branch" },
  },
  {
    id: "5",
    type: "IssuesEvent",
    repo: { name: "testuser/repo-a" },
    created_at: "2026-05-04T08:00:00Z",
    payload: {
      action: "closed",
      issue: {
        title: "Bug",
        number: 12,
        html_url: "https://github.com/testuser/repo-a/issues/12",
      },
    },
  },
];

const sampleRss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <item>
      <title>First Post</title>
      <link>https://test.example/first/</link>
      <pubDate>Mon, 04 May 2026 09:00:00 +0000</pubDate>
      <description>Hello</description>
    </item>
    <item>
      <title><![CDATA[Second & Post]]></title>
      <link>https://test.example/second/</link>
      <pubDate>Tue, 05 May 2026 09:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

function mockFetchOnce(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string | URL) => handler(url.toString()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  __internal.cache.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("githubUsernameFrom", () => {
  it("extracts username from a github url", () => {
    expect(__internal.githubUsernameFrom("https://github.com/foo")).toBe("foo");
  });

  it("returns null for non-github hosts", () => {
    expect(__internal.githubUsernameFrom("https://example.com/foo")).toBeNull();
  });

  it("returns null for malformed urls", () => {
    expect(__internal.githubUsernameFrom("not-a-url")).toBeNull();
    expect(__internal.githubUsernameFrom(undefined)).toBeNull();
  });
});

describe("blogFeedUrlFrom", () => {
  it("derives /index.xml from a blog root", () => {
    expect(__internal.blogFeedUrlFrom("https://blog.example/")).toBe(
      "https://blog.example/index.xml"
    );
  });

  it("respects PERSONA_BLOG_FEED_URL override", () => {
    process.env.PERSONA_BLOG_FEED_URL = "https://x.example/feed";
    try {
      expect(__internal.blogFeedUrlFrom("https://blog.example/")).toBe(
        "https://x.example/feed"
      );
    } finally {
      Reflect.deleteProperty(process.env, "PERSONA_BLOG_FEED_URL");
    }
  });
});

describe("getRecentActivityTool", () => {
  it("returns mapped github + blog activity", async () => {
    const fetchMock = mockFetchOnce((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return new Response(JSON.stringify(sampleEvents), { status: 200 });
      }
      return new Response(sampleRss, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    });

    const t = getRecentActivityTool();
    if (!t.execute) {
      throw new Error("tool has no execute");
    }
    const out = (await t.execute({}, { toolCallId: "x", messages: [] })) as {
      github: { type: string; title: string; link?: string }[];
      blog: { title: string; link?: string; when: string }[];
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.github).toHaveLength(4);
    expect(out.github[0]).toMatchObject({
      type: "push",
      link: "https://github.com/testuser/repo-a",
    });
    expect(out.github[0].title).toContain("repo-a@main");
    expect(out.github[0].title).toContain("Add a thing");
    expect(out.github[1]).toMatchObject({
      type: "pull_request",
      link: "https://github.com/testuser/repo-b/pull/7",
    });
    expect(out.github.find((e) => e.type === "issue")).toBeDefined();
    expect(out.github.find((e) => e.type === "create")).toBeDefined();

    expect(out.blog).toHaveLength(2);
    expect(out.blog[0].title).toBe("First Post");
    expect(out.blog[1].title).toBe("Second & Post");
    expect(out.blog[0].when).toBe("2026-05-04T09:00:00.000Z");
  });

  it("caches per source within the TTL", async () => {
    const fetchMock = mockFetchOnce((url) =>
      url.startsWith("https://api.github.com/")
        ? new Response(JSON.stringify(sampleEvents), { status: 200 })
        : new Response(sampleRss, { status: 200 })
    );
    const t = getRecentActivityTool();
    if (!t.execute) {
      throw new Error("tool has no execute");
    }
    await t.execute({}, { toolCallId: "1", messages: [] });
    await t.execute({}, { toolCallId: "2", messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns empty arrays when both fetches fail", async () => {
    const fetchMock = mockFetchOnce(
      () => new Response("nope", { status: 500 })
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // suppress expected error logs in this test
    });
    const t = getRecentActivityTool();
    if (!t.execute) {
      throw new Error("tool has no execute");
    }
    const out = (await t.execute({}, { toolCallId: "1", messages: [] })) as {
      github: unknown[];
      blog: unknown[];
    };
    expect(out).toEqual({ github: [], blog: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it("caps each source at 10 items", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      type: "PushEvent",
      repo: { name: "testuser/r" },
      created_at: "2026-05-04T00:00:00Z",
      payload: { ref: "refs/heads/main", commits: [{ message: `c${i}` }] },
    }));
    let blogItems = "";
    for (let i = 0; i < 30; i++) {
      blogItems += `<item><title>p${i}</title><link>https://e/${i}</link><pubDate>Mon, 04 May 2026 09:00:00 +0000</pubDate></item>`;
    }
    const rss = `<?xml version="1.0"?><rss><channel>${blogItems}</channel></rss>`;
    mockFetchOnce((url) =>
      url.startsWith("https://api.github.com/")
        ? new Response(JSON.stringify(many), { status: 200 })
        : new Response(rss, { status: 200 })
    );
    const t = getRecentActivityTool();
    if (!t.execute) {
      throw new Error("tool has no execute");
    }
    const out = (await t.execute({}, { toolCallId: "x", messages: [] })) as {
      github: unknown[];
      blog: unknown[];
    };
    expect(out.github).toHaveLength(10);
    expect(out.blog).toHaveLength(10);
  });
});
