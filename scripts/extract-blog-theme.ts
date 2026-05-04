/**
 * One-shot helper for re-checking the blog's CSS-variable palette. Per
 * SPEC §3.4 'Source extraction' — the canonical visual identity comes from
 * https://alexdarbyshire.com (a Hugo `terminal`-theme blog). Running this
 * fetches the blog's homepage, follows every `<link rel="stylesheet">`,
 * and dumps the unique `--name: value` declarations it sees so we can
 * reconcile `theme/tokens.css` against them.
 *
 * It does NOT write `theme/tokens.css` automatically. The blog's body CSS
 * and its OpenGraph image have drifted apart at times (e.g. body shifted
 * to a warm gold accent while the OG still uses sage green) — a human
 * picks the source of truth before editing tokens.
 *
 * Run: `pnpm theme:extract`
 */

const BLOG_URL = process.env.BLOG_URL ?? "https://alexdarbyshire.com/";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return res.text();
}

function extractStylesheetUrls(html: string, baseUrl: string): string[] {
  const linkRe =
    /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const urls = new Set<string>();
  for (const match of html.matchAll(linkRe)) {
    urls.add(new URL(match[1], baseUrl).toString());
  }
  return [...urls];
}

type Decl = { name: string; value: string; source: string };

function extractCustomProps(css: string, source: string): Decl[] {
  const decls: Decl[] = [];
  const re = /(--[a-zA-Z][\w-]*)\s*:\s*([^;}]+?)\s*(?=;|\})/g;
  for (const match of css.matchAll(re)) {
    decls.push({ name: match[1], value: match[2].trim(), source });
  }
  return decls;
}

function extractFontFamilies(css: string): string[] {
  const fonts = new Set<string>();
  const re = /font-family\s*:\s*([^;}!]+)/gi;
  for (const match of css.matchAll(re)) {
    fonts.add(match[1].trim());
  }
  return [...fonts];
}

async function main(): Promise<void> {
  console.log(`# Source: ${BLOG_URL}\n`);

  const html = await fetchText(BLOG_URL);
  const sheets = extractStylesheetUrls(html, BLOG_URL);
  console.log(`# Stylesheets discovered: ${sheets.length}`);

  const allDecls = new Map<string, Decl>();
  const allFonts = new Set<string>();

  for (const url of sheets) {
    try {
      const css = await fetchText(url);
      for (const decl of extractCustomProps(css, url)) {
        if (!allDecls.has(decl.name)) {
          allDecls.set(decl.name, decl);
        }
      }
      for (const font of extractFontFamilies(css)) {
        allFonts.add(font);
      }
    } catch (err) {
      console.error(`  skip ${url}: ${(err as Error).message}`);
    }
  }

  console.log("\n## CSS custom properties (first occurrence wins)\n");
  for (const decl of [...allDecls.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    console.log(`  ${decl.name}: ${decl.value};`);
  }

  console.log("\n## font-family stacks seen\n");
  for (const font of allFonts) {
    console.log(`  ${font}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
