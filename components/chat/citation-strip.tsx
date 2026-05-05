"use client";

import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { type Citation, citationsFromMessageParts } from "@/lib/citations";
import { cn } from "@/lib/utils";

/**
 * Citation strip rendered below an assistant message (SPEC §3.1).
 *
 * Aggregates `searchCareerHistory` chunks across the message's tool calls,
 * filters via the three rules in `lib/citations.ts`, and renders one chip
 * per eligible source. Each chip:
 *   - links to the chunk's `publicUrl` in a new tab,
 *   - shows the chunk's `headingPath` (or host as fallback),
 *   - reveals an og: title/description popover on hover (lazy-fetched
 *     via `/api/preview` — host allowlist enforced server-side).
 *
 * Renders nothing when there are no eligible chips.
 */

type Props = {
  parts: readonly unknown[] | undefined;
};

export function CitationStrip({ parts }: Props) {
  const { data: session } = useSession();
  const isOwner = session?.user?.isOwner ?? false;
  const citations = citationsFromMessageParts(parts, isOwner);
  if (citations.length === 0) {
    return null;
  }
  return (
    <nav
      aria-label="Sources cited in this answer"
      className="mt-2 flex flex-wrap gap-1.5"
      data-testid="citation-strip"
    >
      {citations.map((c) => (
        <CitationChip citation={c} key={c.url} />
      ))}
    </nav>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  return (
    <HoverCard closeDelay={80} openDelay={120}>
      <HoverCardTrigger asChild>
        <a
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground"
          )}
          data-testid="citation-chip"
          href={citation.url}
          rel="noreferrer noopener"
          target="_blank"
        >
          <Favicon host={citation.host} />
          <span className="max-w-[18ch] truncate" title={citation.label}>
            {citation.label}
          </span>
          <ExternalLinkIcon
            aria-hidden="true"
            className="size-3 shrink-0 opacity-60"
          />
        </a>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-80 p-0"
        data-testid="citation-popover"
        side="top"
      >
        <CitationPreview citation={citation} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Favicon via Google's `s2/favicons` endpoint. It's the smallest dependency-
 * free way to get a host glyph; no auth, no token, no per-request cost.
 * Forks that want to drop the third-party fetch can replace this with a
 * lucide `LinkIcon` — the chip still works.
 */
function Favicon({ host }: { host: string }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="size-3.5 shrink-0 rounded-sm"
      height={14}
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      unoptimized
      width={14}
    />
  );
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; title?: string; description?: string; image?: string }
  | { status: "fallback" };

function CitationPreview({ citation }: { citation: Citation }) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    if (state.status !== "idle") {
      return;
    }
    setState({ status: "loading" });
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/preview?url=${encodeURIComponent(citation.url)}`
        );
        if (!res.ok) {
          if (!cancelled) {
            setState({ status: "fallback" });
          }
          return;
        }
        const data = (await res.json()) as {
          title?: string;
          description?: string;
          image?: string;
        };
        if (!cancelled) {
          if (data.title || data.description) {
            setState({ status: "ready", ...data });
          } else {
            setState({ status: "fallback" });
          }
        }
      } catch {
        if (!cancelled) {
          setState({ status: "fallback" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [citation.url, state.status]);

  return (
    <div className="flex flex-col gap-1.5 p-3 text-[12px]">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
        <Favicon host={citation.host} />
        <span className="truncate">{citation.host}</span>
      </div>
      {state.status === "ready" ? (
        <>
          {state.title && (
            <div className="font-medium text-foreground leading-snug">
              {state.title}
            </div>
          )}
          {state.description && (
            <div className="line-clamp-3 text-muted-foreground leading-snug">
              {state.description}
            </div>
          )}
        </>
      ) : (
        <div className="break-all text-foreground leading-snug">
          {citation.url}
        </div>
      )}
    </div>
  );
}
