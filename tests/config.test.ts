import { expect, test, describe } from "bun:test";
import { normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
	test("empty/invalid input → safe defaults", () => {
		const c = normalizeConfig(null);
		expect(c.rules).toEqual([]);
		expect(c.unknownPlaceholder).toBe("drop-line");
		expect(c.sandbox).toBe("windows_sandbox");
		expect(c.blacklist).toContain("Authorization");
	});

	test("keeps valid rules, drops rules without a template", () => {
		const c = normalizeConfig({
			rules: [
				{ match: { provider: "Axon", modelId: "gpt-5.5" }, template: "codex.headers" },
				{ match: { modelId: "x" } }, // missing template → dropped
				"not-an-object",
			],
		});
		expect(c.rules).toEqual([
			{ match: { provider: "Axon", modelId: "gpt-5.5" }, template: "codex.headers" },
		]);
	});

	test("strips unknown match fields, keeps recognized ones", () => {
		const c = normalizeConfig({
			rules: [{ match: { provider: "Axon", bogus: "x", modelIdRegex: "^claude-" }, template: "t" }],
		});
		expect(c.rules[0]!.match).toEqual({ provider: "Axon", modelIdRegex: "^claude-" });
	});

	test("custom blacklist replaces default; empty array falls back to default", () => {
		expect(normalizeConfig({ blacklist: ["X-Only"] }).blacklist).toEqual(["X-Only"]);
		expect(normalizeConfig({ blacklist: [] }).blacklist).toContain("Authorization");
	});

	test("unknownPlaceholder accepts only keep|drop-line", () => {
		expect(normalizeConfig({ unknownPlaceholder: "keep" }).unknownPlaceholder).toBe("keep");
		expect(normalizeConfig({ unknownPlaceholder: "bogus" }).unknownPlaceholder).toBe("drop-line");
	});

	test("custom sandbox honored", () => {
		expect(normalizeConfig({ sandbox: "linux_sandbox" }).sandbox).toBe("linux_sandbox");
	});
});
