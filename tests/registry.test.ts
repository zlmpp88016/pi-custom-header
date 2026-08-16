import { expect, test, describe } from "bun:test";
import { resolveTemplateName } from "../src/registry.js";
import type { Rule } from "../src/types.js";

const AXON_RULES: Rule[] = [
	{ match: { provider: "Axon" }, template: "custom.headers" },
	{ match: { provider: "Axon", modelId: "gpt-5.5" }, template: "codex.headers" },
	{ match: { provider: "Axon", modelId: "gpt-5.4" }, template: "codex.headers" },
	{ match: { provider: "Axon", modelIdRegex: "^claude-" }, template: "claude-code.headers" },
	{ match: {}, template: "global.headers" },
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

	test("provider rule covers models without a model-level match", () => {
		for (const id of ["deepseek-v4-pro", "glm-5.2", "grok-4.5"]) {
			expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id })).toBe("custom.headers");
		}
	});

	test("undefined model → null", () => {
		expect(resolveTemplateName(AXON_RULES, undefined)).toBeNull();
	});

	test("global rule is used after model and provider scopes miss", () => {
		expect(resolveTemplateName(AXON_RULES, { provider: "Other", id: "gpt-5.5" })).toBe("global.headers");
	});

	test("model scope wins even when a matching provider rule appears first", () => {
		expect(resolveTemplateName(AXON_RULES, { provider: "Axon", id: "gpt-5.5" })).toBe("codex.headers");
	});

	test("first matching rule wins within the same scope", () => {
		const rules: Rule[] = [
			{ match: { modelIdRegex: "^gpt-" }, template: "generic.headers" },
			{ match: { modelId: "gpt-5.5" }, template: "special.headers" },
		];
		expect(resolveTemplateName(rules, { id: "gpt-5.5" })).toBe("generic.headers");
	});

	test("empty match {} is the lowest-priority catch-all", () => {
		const rules: Rule[] = [
			{ match: {}, template: "fallback.headers" },
			{ match: { provider: "Axon" }, template: "provider.headers" },
		];
		expect(resolveTemplateName(rules, { provider: "Axon", id: "anything" })).toBe("provider.headers");
		expect(resolveTemplateName(rules, { provider: "Other", id: "anything" })).toBe("fallback.headers");
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
