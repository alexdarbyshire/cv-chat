import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Artifact } from "@/components/chat/create-artifact";

/**
 * PDF artifact (SPEC §3.8 v2). Used by the tailored-resume tool: the tool
 * already has a public Blob URL, so the renderer is just a browser-native
 * iframe pointing at that URL plus a small overlay (filename, file-size
 * badge, open-in-new-tab link). No PDF.js — every modern browser ships a
 * native PDF viewer and the iframe lets us avoid ~150KB of JS bundle.
 */

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").pop();
    return last && last.length > 0 ? last : "resume.pdf";
  } catch {
    return "resume.pdf";
  }
}

const KB = 1024;
const MB = KB * KB;

function formatBytes(bytes: number): string {
  if (bytes < KB) {
    return `${bytes} B`;
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(0)} KB`;
  }
  return `${(bytes / MB).toFixed(1)} MB`;
}

function PdfArtifactContent({
  content,
  title,
}: {
  content: string;
  title: string;
}) {
  const url = content;
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }
    let cancelled = false;
    fetch(url, { method: "HEAD" })
      .then((res) => {
        if (cancelled) {
          return;
        }
        const len = res.headers.get("content-length");
        if (len) {
          setSize(Number.parseInt(len, 10));
        }
      })
      .catch(() => {
        // size badge is optional — drop quietly
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Generating PDF…
      </div>
    );
  }

  const filename = fileNameFromUrl(url);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-3 border-border/40 border-b bg-card/60 px-4 py-2 text-[12px]">
        <span className="truncate text-foreground" title={filename}>
          {filename}
        </span>
        {size !== null && (
          <span className="rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 font-mono text-muted-foreground text-[11px]">
            {formatBytes(size)}
          </span>
        )}
        <a
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open in new tab
          <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      <iframe
        className="h-full w-full flex-1 bg-background"
        src={url}
        title={title}
      />
    </div>
  );
}

export const pdfArtifact = new Artifact<"pdf">({
  kind: "pdf",
  description: "A pinned PDF takeaway (e.g. a tailored one-page resume).",
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === "data-pdfArtifact") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: true,
        status: "idle",
      }));
    }
  },
  content: PdfArtifactContent,
  actions: [],
  toolbar: [],
});
