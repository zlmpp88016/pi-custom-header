import { expect, test, describe } from "bun:test";
import { resolveTemplateName } from "../src/registry.js";
import type { Rule } from "../src/types.js";

const AXON_RULES: Rule[] = [
	{ match: { provider: "Axon", modelId: "gpt-5.5" }, template: "codex.headers" },
	{ match: { provider: "Axon", modelId: "gpt-5.4" }, template: "codex.headers" },
	{ match: { provider: "Axon", modelIdRegex: "^claude-" }, template: "claude-code.headers" },
];

describe("resolveTemplateName", () => {
	test("exact modelId match", () => {
		expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id: "gpt-5.5" })).toBe("codex.headers");
	});

	test("regex covers all claude models", () => {
		for (const id of ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"]) {
			expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id })).toBe("claude-code.headers");
		}
	});

	test("unmatched model in same provider → null (passthrough)", () => {
		expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id: "deepseek-v4-pro" })).toBeNull();
		expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id: "glm-5.2" })).toBeNull();
		expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id: "grok-4.5" })).toBeNull();
	});

	test("undefined model → null", () => {
		expect(resolveTemplateName(AXON_RULES, undefined)).toBeNull();
	});

	test("provider mismatch → null", () => {
		expect(resolveTemplateName(AXON_RULES, { provider: "Other", id: "gpt-5.5" })).toBeNull();
	});

	test("first matching rule wins (order matters)", () => {
		const rules: Rule[] = [
			{ match: { modelIdRegex: "^gpt-" }, template: "generic.headers" },
			{ match: { modelId: "gpt-5.5" }, template: "special.headers" },
		];
		expect(resolveTemplateName(rules, { id: "gpt-5.5" })).toBe("generic.headers");
	});

	test("empty match {} is catch-all", () => {
		const rules: Rule[] = [{ match: {}, template: "fallback.headers" }];
		expect(resolveTemplateName(rules, { id: "anything" })).toBe("fallback.headers");
	});

	test("invalid regex skips the rule without throwing", () => {
		const rules: Rule[] = [
			{ match: { modelIdRegex: "[invalid(" }, template: "bad.headers" },
			{ match: { modelId: "x" }, template: "good.headers" },
		];
		expect(resolveTemplateName(rules, { id: "x" })).toBe("good.headers");
	});

	test("modelIdRegex with undefined model id → no match", () => {
		const rules: Rule[] = [{ match: { modelIdRegex: "^claude-" }, template: "c.headers" }];
		expect(resolveTemplateName(rules, { provider: "Axon" })).toBeNull();
	});
});
