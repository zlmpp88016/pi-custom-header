import { expect, test, describe, afterEach } from "bun:test";
import { redactSecrets, setDebugEnabled, isDebugEnabled } from "../src/logger.js";

afterEach(() => setDebugEnabled(false));

describe("redactSecrets", () => {
	test("redacts a Bearer token", () => {
		const out = redactSecrets("Authorization: Bearer ah-FAKE0000000000000000000000");
		expect(out).not.toContain("ah-FAKE");
		expect(out).toContain("[REDACTED]");
	});

	test("redacts a bare ah- token value", () => {
		const out = redactSecrets("token=ah-FAKE0000000000000000000000deadbeef");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("ah-FAKE");
	});

	test("leaves ordinary text untouched", () => {
		expect(redactSecrets("session-id: 019f55eb-f438-7271")).toBe("session-id: 019f55eb-f438-7271");
	});
});

describe("debug gate", () => {
	test("defaults to disabled", () => {
		expect(isDebugEnabled()).toBe(false);
	});

	test("toggles via setDebugEnabled", () => {
		setDebugEnabled(true);
		expect(isDebugEnabled()).toBe(true);
		setDebugEnabled(false);
		expect(isDebugEnabled()).toBe(false);
	});
});
