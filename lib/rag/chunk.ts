/**
 * Markdown chunker. Splits a document by H1/H2/H3 headings, preserving the
 * heading path as `metadata.title` so retrieved chunks can announce their
 * section context. Oversized sections are split into overlapping windows.
 *
 * Char-based sizing (≈4 chars/token for English) — good enough for the
 * embedding model's 8K window. Swap to tiktoken if we ever bump up against
 * the limit; not worth the dep right now.
 */

export type Chunk = {
  sourcePath: string;
  chunkIndex: number;
  content: string;
  metadata: {
    title?: string;
    publicUrl?: string;
    tokens?: number;
  };
};

export type ChunkOptions = {
  /** Drop sections shorter than this (post-trim). Defaults to 64. */
  minChars?: number;
  /** Soft target size for chunks. Defaults to 1800 (~450 tokens). */
  targetChars?: number;
  /** Overlap between split halves of an oversized section. Defaults to 200. */
  overlapChars?: number;
};

const DEFAULTS = {
  minChars: 64,
  targetChars: 1800,
  overlapChars: 200,
} satisfies Required<ChunkOptions>;

const HEADING_RE = /^(#{1,3})[ \t]+(.+?)\s*$/;

type Section = {
  /** Heading stack at the start of the section, e.g. ["Career", "Acme", "Senior Engineer"]. */
  headingPath: string[];
  /** Body text, heading line included verbatim. */
  body: string;
};

function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  const stack: string[] = ["", "", ""]; // [h1, h2, h3]
  let current: Section = { headingPath: [], body: "" };

  const flush = () => {
    if (current.body.trim().length > 0) {
      sections.push({
        headingPath: current.headingPath.filter(Boolean),
        body: current.body,
      });
    }
  };

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      flush();
      const level = m[1].length;
      const title = m[2];
      stack[level - 1] = title;
      // Lower-level headings invalidate deeper ones.
      for (let i = level; i < stack.length; i++) {
        stack[i] = "";
      }
      current = {
        headingPath: stack.slice(0, level).filter(Boolean),
        body: `${line}\n`,
      };
    } else {
      current.body += `${line}\n`;
    }
  }
  flush();

  return sections;
}

function splitOversized(
  text: string,
  targetChars: number,
  overlapChars: number
): string[] {
  if (text.length <= targetChars) {
    return [text];
  }
  const out: string[] = [];
  const stride = Math.max(1, targetChars - overlapChars);
  for (let i = 0; i < text.length; i += stride) {
    const end = Math.min(i + targetChars, text.length);
    out.push(text.slice(i, end));
    if (end >= text.length) {
      break;
    }
  }
  return out;
}

export function chunkMarkdown(
  markdown: string,
  sourcePath: string,
  opts: ChunkOptions = {}
): Chunk[] {
  const { minChars, targetChars, overlapChars } = { ...DEFAULTS, ...opts };
  const sections = parseSections(markdown);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const trimmed = section.body.trim();
    if (trimmed.length < minChars) {
      continue;
    }
    const pieces = splitOversized(trimmed, targetChars, overlapChars);
    for (const piece of pieces) {
      chunks.push({
        sourcePath,
        chunkIndex: chunkIndex++,
        content: piece,
        metadata: {
          title:
            section.headingPath.length > 0
              ? section.headingPath.join(" > ")
              : undefined,
          tokens: Math.ceil(piece.length / 4),
        },
      });
    }
  }

  return chunks;
}
