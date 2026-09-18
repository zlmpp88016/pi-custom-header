import { expect, test, describe, beforeEach } from "bun:test";
import {
	clearOpencodeSessionCache,
	generateOpencodeId,
	getOpencodeRequestId,
	getOpencodeSessionId,
} from "../src/opencode.js";

describe("opencode identifier generation", () => {
	test("generateOpencodeId returns 26 chars with 12 hex + 14 base62", () => {
		const id = generateOpencodeId(false);
		expect(id).toHaveLength(26);

		const hexPart = id.slice(0, 12);
		const rndPart = id.slice(12);

		expect(/^[0-9a-f]{12}$/.test(hexPart)).toBe(true);
		expect(/^[0-9a-zA-Z]{14}$/.test(rndPart)).toBe(true);
	});

	test("desc=true inverts the 48-bit time value compared to desc=false at same timestamp", () => {
		const ts = 1773733845000;
		// Reset counter by setting lastTs different
		const idAsc = generateOpencodeId(false, ts);
		const idDesc = generateOpencodeId(true, ts + 1);

		expect(idAsc).toHaveLength(26);
		expect(idDesc).toHaveLength(26);
		// With desc=true, hex starts with high byte (~0x0a -> 0xf5)
		const firstByteAsc = parseInt(idAsc.slice(0, 2), 16);
		const firstByteDesc = parseInt(idDesc.slice(0, 2), 16);
		// Sum of inverted bytes is approximately 0xff (within ms diff)
		expect(firstByteAsc + firstByteDesc).toBeGreaterThanOrEqual(0xf0);
	});
});

describe("opencode session and request headers", () => {
	beforeEach(() => {
		clearOpencodeSessionCache();
	});

	test("x-opencode-session has ses_ prefix and correct length", () => {
		const sid = getOpencodeSessionId("test-parent-1");
		expect(sid.startsWith("ses_")).toBe(true);
		expect(sid).toHaveLength(30); // "ses_" (4) + 26
	});

	test("x-opencode-request has msg_ prefix and correct length", () => {
		const req1 = getOpencodeRequestId();
		const req2 = getOpencodeRequestId();
		expect(req1.startsWith("msg_")).toBe(true);
		expect(req2.startsWith("msg_")).toBe(true);
		expect(req1).toHaveLength(30); // "msg_" (4) + 26
		expect(req1).not.toBe(req2);
	});

	test("same parent_session_id returns IDENTICAL x-opencode-session across multiple calls", () => {
		const sid1 = getOpencodeSessionId("parent-session-12345");
		const sid2 = getOpencodeSessionId("parent-session-12345");
		const sid3 = getOpencodeSessionId("parent-session-12345");

		expect(sid1).toBe(sid2);
		expect(sid2).toBe(sid3);
	});

	test("different parent_session_id returns DIFFERENT x-opencode-session", () => {
		const sidA = getOpencodeSessionId("parent-session-A");
		const sidB = getOpencodeSessionId("parent-session-B");

		expect(sidA).not.toBe(sidB);
	});
});
