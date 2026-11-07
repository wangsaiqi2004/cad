/**
 * The snippets the Embed dialog offers, built from the playground's base URL and a
 * `#z=` share hash. Pure so it can be unit-tested; the dialog lives in actions.ts.
 *
 * `embed.html` is an HTML page, so it can only be framed, never used as an image:
 * the iframe snippet points at it. The Markdown snippet links to the playground
 * share URL; when the plan is an unedited bundled example it shows that example's
 * pre-rendered drawing from the docs site, which any Markdown renderer displays as
 * an image. An edited plan has no static image, so it gets a plain link. The hash
 * is a fragment, so the plan source in it never reaches the server either way.
 */

/** Where the docs site serves the example gallery (`docs-site/sync-docs.mjs` writes it). */
export const EXAMPLE_IMAGE_BASE = "https://archlang.uk/examples/";

/**
 * The docs site's drawing of bundled example `name`: `<name>.svg` for a single-storey
 * plan, `<name>.L<level>.svg` for one storey of a multi-storey plan — the gallery's
 * own naming, the same one `arch compile` uses for storey files.
 */
export function exampleImageUrl(name: string, level: number | null): string {
  return `${EXAMPLE_IMAGE_BASE}${level === null ? `${name}.svg` : `${name}.L${level}.svg`}`;
}

export interface EmbedSnippets {
  /** The playground URL that opens this plan (`<base>#z=…`), the same one Copy link copies. */
  shareUrl: string;
  /** The chrome-less embed page for this plan (`<base>embed.html#z=…`). */
  embedUrl: string;
  /** An `<iframe>` of the embed page, for HTML hosts. */
  iframe: string;
  /** An image of the plan linking to the share URL, or a plain link when there is no image. Never `embed.html`. */
  markdown: string;
}

/** `base` is the directory URL the playground is served from, ending in `/`. `imageUrl`
 *  is a static drawing of the plan, when one exists ({@link exampleImageUrl}). */
export function embedSnippets(base: string, hash: string, imageUrl?: string): EmbedSnippets {
  const shareUrl = `${base}${hash}`;
  const embedUrl = `${base}embed.html${hash}`;
  const iframe = `<iframe src="${embedUrl}" width="720" height="480" style="border:1px solid #e3e0d8;border-radius:10px" title="ArchLang floor plan" loading="lazy"></iframe>`;
  const markdown = imageUrl
    ? `[![ArchLang floor plan](${imageUrl})](${shareUrl})`
    : `[ArchLang floor plan — open it in the playground](${shareUrl})`;
  return { shareUrl, embedUrl, iframe, markdown };
}
