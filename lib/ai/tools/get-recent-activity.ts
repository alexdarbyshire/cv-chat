import { tool } from "ai";
import { z } from "zod";
import { persona } from "@/lib/persona";

export type Activity = {
  type: string;
  title: string;
  when: string;
  link?: string;
};

const PER_SOURCE_LIMIT = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { fetchedAt: number; items: Activity[] };
const cache = new Map<string, CacheEntry>();

function getCached(key: string): Activity[] | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.items;
}

function setCached(key: string, items: Activity[]): void {
  cache.set(key, { fetchedAt: Date.now(), items });
}

function githubUsernameFrom(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) {
      return null;
    }
    const segments = u.pathname.split("/").filter(Boolean);
    return segments[0] ?? null;
  } catch {
    return null;
  }
}

function blogFeedUrlFrom(blogUrl: string | undefined): string | null {
  const override = process.env.PERSONA_BLOG_FEED_URL?.trim();
  if (override) {
    return override;
  }
  if (!blogUrl) {
    return null;
  }
  try {
    const base = new URL(blogUrl);
    return new URL("/index.xml", base).toString();
  } catch {
    return null;
  }
}

type GithubEvent = {
  type: string;
  repo?: { name?: string };
  created_at?: string;
  payload?: {
    ref?: string;
    ref_type?: string;
    action?: string;
    number?: number;
    pull_request?: { title?: string; html_url?: string };
    issue?: { title?: string; html_url?: string; number?: number };
    commits?: { message?: string }[];
  };
};

const RELEVANT_GITHUB_TYPES = new Set([
  "PushEvent",
  "PullRequestEvent",
  "CreateEvent",
  "IssuesEvent",
]);

function summariseGithubEvent(event: GithubEvent): Activity | null {
  if (!RELEVANT_GITHUB_TYPES.has(event.type)) {
    return null;
  }
  const repoName = event.repo?.name ?? "";
  const when = event.created_at ?? new Date().toISOString();
  const repoUrl = repoName ? `https://github.com/${repoName}` : undefined;

  if (event.type === "PushEvent") {
    const commits = event.payload?.commits ?? [];
    const ref = event.payload?.ref?.replace(/^refs\/heads\//, "") ?? "";
    const lead = commits[0]?.message?.split("\n")[0] ?? "";
    const title = `Pushed ${commits.length} commit${commits.length === 1 ? "" : "s"} to ${repoName}${ref ? `@${ref}` : ""}${lead ? ` — ${lead}` : ""}`;
    return { type: "push", title, when, link: repoUrl };
  }

  if (event.type === "PullRequestEvent") {
    const action = event.payload?.action ?? "updated";
    const pr = event.payload?.pull_request;
    const title = `${action[0].toUpperCase()}${action.slice(1)} PR in ${repoName}: ${pr?.title ?? `#${event.payload?.number ?? ""}`}`;
    return { type: "pull_request", title, when, link: pr?.html_url ?? repoUrl };
  }

  if (event.type === "IssuesEvent") {
    const action = event.payload?.action ?? "updated";
    const issue = event.payload?.issue;
    const title = `${action[0].toUpperCase()}${action.slice(1)} issue in ${repoName}: ${issue?.title ?? `#${event.payload?.number ?? ""}`}`;
    return {
      type: "issue",
      title,
      when,
      link: issue?.html_url ?? repoUrl,
    };
  }

  if (event.type === "CreateEvent") {
    const refType = event.payload?.ref_type ?? "ref";
    const ref = event.payload?.ref;
    const title = ref
      ? `Created ${refType} ${ref} in ${repoName}`
      : `Created ${refType} ${repoName}`;
    return { type: "create", title, when, link: repoUrl };
  }

  return null;
}

function githubFetch(url: string, withAuth: boolean): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": "cv-chat",
    Accept: "application/vnd.github+json",
  };
  if (withAuth) {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return fetch(url, { headers });
}

async function fetchGithubActivity(username: string): Promise<Activity[]> {
  const cached = getCached(`github:${username}`);
  if (cached) {
    return cached;
  }
  const url = `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=30`;
  try {
    let res = await githubFetch(url, true);
    // If a configured token is rejected (stale/wrong scope), retry unauthenticated —
    // public events are accessible at 60req/h, which is well within the cache rate.
    if (res.status === 401) {
      res = await githubFetch(url, false);
    }
    if (!res.ok) {
      throw new Error(`github events ${res.status}`);
    }
    const events = (await res.json()) as GithubEvent[];
    const items = events
      .map(summariseGithubEvent)
      .filter((a): a is Activity => a !== null)
      .slice(0, PER_SOURCE_LIMIT);
    setCached(`github:${username}`, items);
    return items;
  } catch (error) {
    console.error("[getRecentActivity] github", error);
    return [];
  }
}

const RSS_ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
const RSS_FIELD_RE = (tag: string) =>
  new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");

function decodeXml(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function pickField(item: string, tag: string): string | undefined {
  const m = item.match(RSS_FIELD_RE(tag));
  if (!m) {
    return;
  }
  return decodeXml(m[1]).trim();
}

function rfc822ToIso(input: string | undefined): string {
  if (!input) {
    return new Date().toISOString();
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

async function fetchBlogActivity(feedUrl: string): Promise<Activity[]> {
  const cached = getCached(`blog:${feedUrl}`);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "cv-chat" },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`blog feed ${res.status}`);
    }
    const xml = await res.text();
    const items: Activity[] = [];
    for (const match of xml.matchAll(RSS_ITEM_RE)) {
      const block = match[1];
      const title = pickField(block, "title") ?? "(untitled)";
      const link = pickField(block, "link");
      const pubDate = pickField(block, "pubDate");
      items.push({
        type: "blog_post",
        title,
        when: rfc822ToIso(pubDate),
        link,
      });
      if (items.length >= PER_SOURCE_LIMIT) {
        break;
      }
    }
    setCached(`blog:${feedUrl}`, items);
    return items;
  } catch (error) {
    console.error("[getRecentActivity] blog", error);
    return [];
  }
}

export const getRecentActivityTool = () =>
  tool({
    description:
      "Get the persona's recent public activity from GitHub events and the blog RSS feed. Call this for ANY question about what's recent/current/lately/new (e.g. 'what have you been working on lately?', 'recent projects', 'current focus', 'what have you shipped?'). Prefer this over `searchCareerHistory` for those questions — the corpus is a snapshot, this is the live feed. Returns up to 10 GitHub events and 10 blog posts; cite the link inline when you mention an item. Cached briefly so it's safe to call once per question.",
    inputSchema: z.object({}),
    execute: async () => {
      const username = githubUsernameFrom(persona.socials.github);
      const feedUrl = blogFeedUrlFrom(persona.socials.blog);
      const [github, blog] = await Promise.all([
        username ? fetchGithubActivity(username) : Promise.resolve([]),
        feedUrl ? fetchBlogActivity(feedUrl) : Promise.resolve([]),
      ]);
      return { github, blog };
    },
  });

export const __internal = {
  cache,
  githubUsernameFrom,
  blogFeedUrlFrom,
  summariseGithubEvent,
};
