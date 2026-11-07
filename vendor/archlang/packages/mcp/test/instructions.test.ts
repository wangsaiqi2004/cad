/**
 * The server's `instructions` and the descriptions a host shows a model.
 *
 * `instructions` is SKILL.md's loop condensed for an MCP host, and it is retyped prose, so
 * what is pinned is everything that can go stale: every command it names exists in the CLI
 * manifest and as a tool here, it names them in the order SKILL.md's loop does, and its CLI
 * spelling is the manifest's `invoke` plus the root package's npm name. A renamed command, a
 * reordered loop or a new CLI name turns this red instead of shipping a wrong handshake.
 *
 * The descriptions are held to behaviour: no ADR numbers, no repo file names, and no bare
 * `arch <cmd>` (coreutils owns `arch` on Linux, macOS and Git Bash).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, MANIFEST_COMMAND_NAMES } from "@chanmeng666/archlang";
import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../src/server.js";
import { connect } from "./helpers.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rootPkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")) as {
  name: string;
  bin: Record<string, string>;
};
/** Where the workflow skill the instructions condense lives: the umbrella skill under `skills/`. */
const SKILL_PATH = resolve(REPO, "skills/archlang/SKILL.md");

/** The single-word backticked names in the instructions that the CLI manifest knows. */
const namedCommands = (): string[] => {
  const words = [...INSTRUCTIONS.matchAll(/`([a-z]+)`/g)].map((m) => m[1] as string);
  return [...new Set(words)].filter((w) => MANIFEST_COMMAND_NAMES.includes(w));
};

/** SKILL.md's "The loop" section: from its heading to the next `## ` heading. */
const skillLoop = (): string => {
  expect(existsSync(SKILL_PATH), `SKILL.md not found at ${SKILL_PATH}; if it moved, update SKILL_PATH`).toBe(true);
  const skill = readFileSync(SKILL_PATH, "utf8");
  const start = skill.indexOf("\n## The loop");
  expect(start, "SKILL.md has no '## The loop' section").toBeGreaterThan(-1);
  const end = skill.indexOf("\n## ", start + 1);
  return skill.slice(start, end === -1 ? undefined : end);
};

const firstMention = (text: string, word: string): number => text.search(new RegExp(`\\b${word}\\b`));

describe("server instructions", () => {
  it("are sent in the initialize reply", async () => {
    const client = await connect();
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it("stay short: every host reads them on every session", () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(900);
  });

  it("name only commands the CLI manifest has and the server registers as tools", async () => {
    const named = namedCommands();
    // The loop the card asks for, at minimum; a rewrite that drops a step fails here.
    expect(named).toEqual(expect.arrayContaining(["compile", "describe", "lint", "fix", "finish"]));
    const client = await connect();
    const tools = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const cmd of named) expect(tools.has(cmd), `no tool "${cmd}"`).toBe(true);
    // Every backticked bare word must be a command: a typo'd verb (`desribe`) would otherwise
    // be filtered out of `named` above and slip through unnoticed.
    const unknown = [...INSTRUCTIONS.matchAll(/`([a-z]+)`/g)]
      .map((m) => m[1] as string)
      .filter((w) => !MANIFEST_COMMAND_NAMES.includes(w));
    expect(unknown).toEqual([]);
  });

  it("follow SKILL.md's loop order", () => {
    const loop = skillLoop();
    const named = namedCommands();
    for (const cmd of named)
      expect(firstMention(loop, cmd), `SKILL.md's loop never names "${cmd}"`).toBeGreaterThan(-1);
    const bySkill = [...named].sort((a, b) => firstMention(loop, a) - firstMention(loop, b));
    expect(named).toEqual(bySkill);
  });

  it("spell the CLI the way the manifest and the npm package do", () => {
    // Read through a plain record: this package typechecks against the core's BUILT types, and a
    // stale `dist/` from before `invoke` existed should fail this assertion, not the typecheck.
    const manifest: Record<string, unknown> = { ...buildManifest("0.0.0") };
    const invoke = manifest.invoke;
    expect(typeof invoke).toBe("string");
    expect(Object.keys(rootPkg.bin)).toContain(invoke);
    expect(INSTRUCTIONS).toContain(`\`${invoke} <cmd>\``);
    const npx = [...INSTRUCTIONS.matchAll(/npx -y (\S+) ([a-z<>]+)/g)];
    expect(npx.length).toBeGreaterThan(0);
    for (const [, pkg, cmd] of npx) {
      expect(pkg).toBe(rootPkg.name);
      if (cmd !== "<cmd>") expect(MANIFEST_COMMAND_NAMES).toContain(cmd);
    }
    // The spec is where a model starts; both routes to it are named.
    expect(INSTRUCTIONS).toContain("archlang://spec");
    expect(INSTRUCTIONS).toContain(`npx -y ${rootPkg.name} spec`);
  });
});

describe("this package's README", () => {
  // Same rule the root `test/docs-flags.test.ts` holds the agent-facing docs to.
  const verbs = [...MANIFEST_COMMAND_NAMES, "help"].join("|");
  const bareArch = new RegExp(String.raw`(?<![\w./@-])arch\s+(?:${verbs}|<cmd>|--help|--version)\b`, "g");
  const promptingNpx = /npx @chanmeng666\/archlang(?![\w-])/g;
  const offenders = (text: string): string[] => [
    ...[...text.matchAll(bareArch)].map((m) => `bare \`${m[0]}\``),
    ...[...text.matchAll(promptingNpx)].map((m) => `\`${m[0]}\` without -y`),
  ];

  it("catches the canaries", () => {
    expect(offenders("Run `arch context` first.")).toHaveLength(1);
    expect(offenders("Run `npx @chanmeng666/archlang spec`.")).toHaveLength(1);
    expect(offenders("Run `archlang context`, or `npx -y @chanmeng666/archlang spec`.")).toEqual([]);
  });

  it("never writes a bare `arch <cmd>` or an npx without -y", () => {
    const readme = readFileSync(resolve(REPO, "packages", "mcp", "README.md"), "utf8");
    expect(offenders(readme)).toEqual([]);
  });
});

describe("tool and resource descriptions", () => {
  const BANNED: Array<[RegExp, string]> = [
    [/\bADR\b/, "an ADR number"],
    [/\b[\w-]+\.(?:md|txt|ts|mjs|json)\b/, "a repo file name"],
    [/(?:^|[\s`(])arch\s+[a-z]/, "a bare `arch <cmd>`"],
  ];

  it("state behaviour, not internal references", async () => {
    const client = await connect();
    const texts: Array<[string, string]> = [["instructions", INSTRUCTIONS]];
    for (const t of (await client.listTools()).tools) {
      texts.push([`tool ${t.name}`, t.description ?? ""]);
      const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [k, p] of Object.entries(props)) texts.push([`tool ${t.name}.${k}`, p.description ?? ""]);
    }
    for (const r of (await client.listResources()).resources) texts.push([`resource ${r.uri}`, r.description ?? ""]);
    for (const [where, text] of texts) {
      expect(text.length, `${where} has no description`).toBeGreaterThan(0);
      for (const [re, what] of BANNED) expect(re.test(text), `${where} cites ${what}: ${text}`).toBe(false);
    }
  });
});
