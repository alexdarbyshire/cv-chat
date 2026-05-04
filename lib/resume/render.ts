import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResumeJSON } from "./schema";

/**
 * Bump on any change to `templates/resume.typ` so the Blob cache invalidates
 * and the next request re-renders with the new layout. Otherwise visitors who
 * generated a PDF before the bump would keep seeing the old artwork.
 */
export const TEMPLATE_VERSION = "1";

const TEMPLATE_PATH =
  process.env.RESUME_TEMPLATE_PATH ?? "templates/resume.typ";

let _template: string | null = null;
async function loadTemplate(): Promise<string> {
  if (_template === null) {
    const abs = join(process.cwd(), TEMPLATE_PATH);
    _template = await readFile(abs, "utf8");
  }
  return _template;
}

export type RenderOptions = {
  /** Override the loaded template (useful for tests). */
  templateOverride?: string;
};

/**
 * Render ResumeJSON to a one-page PDF via typst (WASM). Returns the raw bytes
 * as a Node Buffer (typst.ts returns Uint8Array; Buffer is what downstream
 * consumers — @vercel/blob, fs.writeFile — actually accept).
 *
 * Throws on compile failure — the caller decides whether to retry, fall back
 * to a static PDF, or surface the error.
 */
export async function renderResume(
  json: ResumeJSON,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const { $typst } = await import("@myriaddreamin/typst.ts");
  const mainContent = opts.templateOverride ?? (await loadTemplate());

  const pdf = await $typst.pdf({
    mainContent,
    inputs: { resume: JSON.stringify(json) },
  });

  if (!pdf) {
    throw new Error("typst returned no PDF bytes for the given content");
  }
  return Buffer.from(pdf);
}
