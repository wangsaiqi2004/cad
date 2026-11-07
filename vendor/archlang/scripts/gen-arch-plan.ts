/**
 * Generate `docs-site/public/arch-plan.js`, the `<arch-plan>` web component the docs site
 * serves at `/arch-plan.js`: the `cdn` build of `packages/web-component` (the element, with the
 * core imported from the pinned jsDelivr `+esm` URL at this repo's version). The build function
 * is the package's own, so the served file, `npm -w packages/web-component run build` and
 * `packages/web-component/test/served-file.test.ts` cannot disagree. The file carries the core
 * version, so a version bump regenerates it (as it does the plugin manifest).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArchPlan } from "../packages/web-component/scripts/build.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SERVED_ARCH_PLAN = "docs-site/public/arch-plan.js";

const text = await buildArchPlan("cdn");
writeFileSync(resolve(ROOT, SERVED_ARCH_PLAN), text);
process.stdout.write(`✓ generated ${SERVED_ARCH_PLAN} (${Buffer.byteLength(text)} bytes)\n`);
