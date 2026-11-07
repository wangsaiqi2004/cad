/**
 * Assemble a single paste-ready prompt for an AI assistant from the current
 * plan: an intro line, the source in an ```arch fence, the compact `describe()`
 * facts (rooms/areas/adjacency + an access summary), the diagnostics with
 * line/col/fix, and a pointer to the language spec. Pure and deterministic so it
 * can be unit-tested — the UI wiring (button + clipboard) lives in actions.ts.
 */
import type { DiagnosticJson, SceneSummary } from "archlang";

export interface LlmPromptInput {
  /** The current editor source. */
  source: string;
  /** `describe()` output for the same source (diagnostics field is ignored here). */
  facts: SceneSummary;
  /** The current diagnostics, already projected via `diagnosticToJson`. */
  diagnostics: DiagnosticJson[];
}

/** The compact facts object embedded in the prompt — a small, stable subset of
 *  `describe()` (rooms with areas/uses/adjacency + an access summary). */
interface CompactFacts {
  plan: string;
  units: "mm";
  totals: SceneSummary["totals"];
  rooms: Array<{ id: string; label?: string; area_m2: number; uses: string[]; adjacent: string[] }>;
  access: { hasEntrance: boolean; entrances: string[]; unreachable: string[] };
}

/** Project the full describe() summary down to the compact, prompt-sized subset. */
function compactFacts(facts: SceneSummary): CompactFacts {
  return {
    plan: facts.plan,
    units: facts.units,
    totals: facts.totals,
    rooms: facts.rooms.map((r) => ({
      id: r.id,
      ...(r.label != null ? { label: r.label } : {}),
      area_m2: r.area_m2,
      uses: r.uses,
      adjacent: r.adjacent,
    })),
    access: {
      hasEntrance: facts.access.hasEntrance,
      entrances: facts.access.entrances,
      unreachable: facts.access.rooms.filter((r) => r.reachable === false).map((r) => r.id),
    },
  };
}

/** One human-readable line per diagnostic: `- [severity] CODE at line:col — message` + a `fix:` line. */
function renderDiagnostics(diagnostics: DiagnosticJson[]): string {
  if (diagnostics.length === 0) return "None — the plan compiles clean.";
  return diagnostics
    .map((d) => {
      const loc = d.line != null && d.col != null ? ` at ${d.line}:${d.col}` : "";
      const code = d.code ?? d.severity;
      const head = `- [${d.severity}] ${code}${loc} — ${d.message}`;
      return d.fix ? `${head}\n  fix: ${d.fix}` : head;
    })
    .join("\n");
}

/**
 * Build the full paste-ready prompt string. Deterministic given its inputs —
 * no clock, no randomness — so the same plan always yields the same text.
 */
export function buildLlmPrompt({ source, facts, diagnostics }: LlmPromptInput): string {
  return [
    "This is an ArchLang floor plan — a small declarative language that compiles to professional SVG floor plans. Below are the source, the computed semantic facts, and the current compiler diagnostics.",
    "",
    "## Source",
    "```arch",
    source.replace(/\n+$/, ""),
    "```",
    "",
    "## Facts (from `describe`)",
    "```json",
    JSON.stringify(compactFacts(facts), null, 2),
    "```",
    "",
    "## Diagnostics",
    renderDiagnostics(diagnostics),
    "",
    "Full language spec: run `npx @chanmeng666/archlang spec` or see https://archlang.uk/spec",
  ].join("\n");
}

/** The chat hosts the "Open in …" links target, each prefilled through its `q` parameter. */
export const CHAT_HOSTS = {
  claude: { name: "Claude", base: "https://claude.ai/new" },
  chatgpt: { name: "ChatGPT", base: "https://chatgpt.com/" },
} as const;
export type ChatHost = keyof typeof CHAT_HOSTS;

/** True when `s` names one of {@link CHAT_HOSTS} (the links carry it as `data-chat-host`). */
export function isChatHost(s: string | undefined): s is ChatHost {
  return s !== undefined && Object.hasOwn(CHAT_HOSTS, s);
}

/**
 * The longest prefilled chat URL a link will carry. Past it the full Copy-for-LLM
 * prompt is copied instead and the link opens the host empty.
 *
 * AN UNMEASURED GUESS: no limit was measured against claude.ai or chatgpt.com, nor
 * against the proxies in front of them; neither host documents one. It is a round
 * figure under common request-line limits. The plan already travels compressed (the
 * share link's `#z=` IS the deflate-raw + base64url payload), so the one lever left is
 * the prompt's own words, kept short enough that every bundled example — the largest
 * being Hillside Villa — fits with 80 characters to
 * spare for another zlib build (`playground/test/llm-prompt.test.ts` holds that).
 */
export const MAX_CHAT_URL = 8000;

/**
 * The short prompt the "Open in Claude / ChatGPT" links prefill: the plan's share
 * link, then one clause saying what `z` is and a Python expression that decodes it.
 * `#z=` is unpadded base64url of raw DEFLATE of the `.arch` UTF-8 (`encodeSrc`,
 * `share.ts` — so zlib's `wbits` is -15); `#src=` (a browser without
 * CompressionStream) is unpadded base64url of the UTF-8. Python ignores surplus "="
 * but rejects missing ones, so a flat "==" restores any padding. Every character is
 * paid for in the URL cap (a space costs 3): the spec pointer did not survive (the
 * link's own domain leads to it). The expression keeps its `.decode()` — without it a
 * reader gets a bytes repr, every non-ASCII character a hex escape.
 */
export function buildChatPrompt(shareUrl: string): string {
  const recipe = /[#&]src=/.test(shareUrl)
    ? "s=b64url(.arch): base64.urlsafe_b64decode(s+'==').decode()"
    : "z=b64url(deflate-raw(.arch)): zlib.decompress(base64.urlsafe_b64decode(z+'=='),-15).decode()";
  return [`ArchLang floor plan: ${shareUrl}`, recipe].join("\n");
}

/**
 * The URL that opens `host` with `prompt` prefilled. When that URL would pass
 * `max` characters, `fits` is false and `url` is the bare host: the caller copies
 * the prompt for the user to paste. Carries no tracking parameter.
 *
 * UNVERIFIED: that `?q=` prefills (or, on ChatGPT, submits) the prompt has not been
 * checked on either host; the e2e suite stubs both hosts and reads only the URL.
 */
export function chatHostUrl(host: ChatHost, prompt: string, max = MAX_CHAT_URL): { url: string; fits: boolean } {
  const { base } = CHAT_HOSTS[host];
  const url = `${base}?q=${encodeURIComponent(prompt)}`;
  return url.length <= max ? { url, fits: true } : { url: base, fits: false };
}
