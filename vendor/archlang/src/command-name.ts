/**
 * The command name every help line, example and doc writes. `package.json` installs two bins,
 * `archlang` and `arch`, for the same `dist/cli.js`; `arch` stays as an alias, but coreutils ships
 * an `arch` on Linux, macOS and Git Bash, so a bare `arch context` there runs the wrong program.
 * Without a global install the call is `npx -y @chanmeng666/archlang <cmd>` (the unscoped npm name
 * `archlang` belongs to another publisher).
 *
 * A leaf with no imports, so a lint rule or `repair` can name the command in a hint without
 * importing `manifest.ts`, which itself imports `lint.ts`. `manifest.ts` re-exports it.
 */
export const CLI_NAME = "archlang";
