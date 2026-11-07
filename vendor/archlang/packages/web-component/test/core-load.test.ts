/**
 * The core-load failure path: when the compiler cannot be imported (jsDelivr unreachable, a
 * version not on npm yet, a CSP that blocks the CDN), `renderPlan` reports it as a problem and
 * never throws, and the next render tries the import again instead of caching the failure.
 * No DOM: `renderPlan` is the element's whole compile path, and the module imports cleanly
 * without one.
 */
import { describe, expect, it, vi } from "vitest";

const attempts = vi.hoisted(() => ({ n: 0 }));
vi.mock("@chanmeng666/archlang", () => {
  attempts.n++;
  throw new Error("offline");
});

describe("renderPlan when the compiler will not load", () => {
  it("reports it in the problems, and retries on the next render", async () => {
    const { renderPlan } = await import("../src/arch-plan.js");
    const first = await renderPlan('plan "x" {\n}\n');
    expect(first.ok).toBe(false);
    expect(first.ok ? [] : first.problems).toEqual([
      expect.stringMatching(/^arch-plan: could not load the ArchLang compiler \(.+\)$/),
    ]);
    const before = attempts.n;
    const second = await renderPlan('plan "x" {\n}\n');
    expect(second.ok).toBe(false);
    expect(attempts.n, "the failed import was cached instead of retried").toBeGreaterThan(before);
  });
});
