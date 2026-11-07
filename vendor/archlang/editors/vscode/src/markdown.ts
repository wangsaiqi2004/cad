/**
 * Markdown preview support: a markdown-it plugin that renders ```arch fences as the
 * compiled floor plan.
 *
 * Pure and dependency-injected (the compile function is passed in), like
 * `diagnostics.ts`: no `vscode` import, no Node API, no markdown-it import — only the
 * few structural shapes of markdown-it it touches. The compile is sync and
 * deterministic, so the plugin renders synchronously, as markdown-it requires.
 */

/** The slice of the core's `compile()` result this plugin reads. */
export interface CoreCompileResult {
  svg: string;
  diagnostics: ReadonlyArray<{ severity: "error" | "warning"; message: string; code?: string }>;
}
export type CoreCompile = (source: string) => CoreCompileResult;

interface FenceToken {
  info: string;
  content: string;
  /** Source line range `[start, end)`, set by markdown-it for block tokens. */
  map?: [number, number] | null;
}
type FenceRule = (tokens: FenceToken[], idx: number, options: unknown, env: unknown, self: unknown) => string;
/** The slice of a markdown-it instance the plugin needs. */
export interface MarkdownItLike {
  renderer: { rules: { fence?: (...args: never[]) => string } };
}

/** Fence languages rendered as plans. `archlang` is tolerated as an alias. */
const ARCH_LANGS: ReadonlySet<string> = new Set(["arch", "archlang"]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The first word of a fence info string (` ```arch title=x ` -> `arch`). */
function fenceLang(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

/** Attributes whose value may hold a `url(#id)` paint or reference. */
const URL_ATTRS = /^(?:style|fill|stroke|clip-path|mask|filter|marker-start|marker-mid|marker-end)$/;

/**
 * Make every id in one SVG unique within the page. Every compiled plan carries the same
 * fixed ids (`poche`, `hatch-*`, the layer ids), and `url(#poche)` resolves to the FIRST
 * match in the document, so a second plan would paint with the first plan's pattern.
 * Each `id`, each `url(#..)` / `href="#.."` reference and each `aria-labelledby` token
 * gets the same per-fence prefix. This post-processes the compiler's output here, in the
 * extension; the core is unchanged.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  // Only attribute values are rewritten, never element text: a room label that happens
  // to read `url(#poche)` is escaped text content and must display unchanged.
  return svg.replace(/(\s)([\w:-]+)="([^"]*)"/g, (m, sp: string, name: string, value: string) => {
    if (name === "id") return `${sp}${name}="${prefix}${value}"`;
    if (name === "href" || name === "xlink:href") {
      return value.startsWith("#") ? `${sp}${name}="#${prefix}${value.slice(1)}"` : m;
    }
    if (name === "aria-labelledby" || name === "aria-describedby") {
      const ids = value
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => prefix + id);
      return `${sp}${name}="${ids.join(" ")}"`;
    }
    if (URL_ATTRS.test(name)) {
      const v = value.replace(
        /url\((['"]?)#([^)'"]+)\1\)/g,
        (_u, q: string, id: string) => `url(${q}#${prefix}${id}${q})`,
      );
      return `${sp}${name}="${v}"`;
    }
    return m;
  });
}

/** The wrapper attributes VS Code's own fence renderer carries, for preview scroll sync. */
function wrapperAttrs(extraClass: string, line: number | undefined): string {
  const dataLine = line === undefined ? "" : ` data-line="${line}"`;
  return `class="archlang-preview${extraClass} code-line"${dataLine}`;
}

/** The HTML for one arch fence body. Never throws. `line` is the fence's first source line. */
export function renderArchFence(compile: CoreCompile, source: string, prefix: string, line?: number): string {
  let result: CoreCompileResult;
  try {
    result = compile(source);
  } catch (e) {
    // The core returns diagnostics instead of throwing; this only guards a broken bundle.
    const message = e instanceof Error ? e.message : String(e);
    result = { svg: "", diagnostics: [{ severity: "error", message, code: "E_INTERNAL" }] };
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0 && result.svg !== "") {
    // The SVG is the compiler's own output: nothing is stripped, and the compiler emits
    // no script. Only its ids are namespaced (see namespaceSvgIds).
    return `<div ${wrapperAttrs("", line)}>${namespaceSvgIds(result.svg, prefix)}</div>\n`;
  }
  const lines = errors.length
    ? errors.map((d) => `${d.code ?? "error"}: ${d.message}`)
    : ["error: the plan produced no drawing"];
  return (
    `<div ${wrapperAttrs(" archlang-preview-error", line)}>` +
    `<pre class="archlang-diagnostics">${escapeHtml(lines.join("\n"))}</pre>` +
    `<pre><code class="language-arch">${escapeHtml(source)}</code></pre></div>\n`
  );
}

/**
 * Register the arch fence rule on a markdown-it instance and return it. Any other
 * fence falls through to the previously installed (default) renderer.
 */
export function installArchFence<T extends MarkdownItLike>(md: T, compile: CoreCompile): T {
  const fallback = md.renderer.rules.fence as FenceRule | undefined;
  let counter = 0;
  const rule: FenceRule = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    if (ARCH_LANGS.has(fenceLang(token.info))) {
      // Unique per fence within one render: the source line when mapped, else a counter.
      const line = token.map?.[0];
      const prefix = `arch${line ?? `c${counter++}`}-`;
      return renderArchFence(compile, token.content, prefix, line);
    }
    if (fallback) return fallback(tokens, idx, options, env, self);
    return `<pre><code>${escapeHtml(token.content)}</code></pre>\n`;
  };
  md.renderer.rules.fence = rule;
  return md;
}

/**
 * The function VS Code's Markdown preview calls with its markdown-it instance. It must
 * return the instance synchronously, so the core is loaded before this is built.
 */
export function createExtendMarkdownIt(compile: CoreCompile): <T extends MarkdownItLike>(md: T) => T {
  return (md) => installArchFence(md, compile);
}
