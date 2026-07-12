import { expect, test, describe } from "bun:test";
import { createRenderContext } from "../src/placeholders.js";
import { renderValue } from "../src/render.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const SID = "019f55eb-f438-7271-b491-87390758c6a2";

function fakeCtx(): ExtensionContext {
	return {
		sessionManager: { getSessionId: () => SID },
	} as unknown as ExtensionContext;
}

function rc(sandbox = "windows_sandbox") {
	return createRenderContext(fakeCtx(), sandbox);
}

describe("renderValue — placeholders", () => {
	test("session_id resolves to the current session id", () => {
		expect(renderValue("{{session_id}}", rc(), "drop-line").value).toBe(SID);
	});

	test("window_id is <session_id>:0", () => {
		expect(renderValue("{{window_id}}", rc(), "drop-line").value).toBe(`${SID}:0`);
	});

	test("request_id is a fresh uuid v7 (not the session id)", () => {
		const v = renderValue("{{request_id}}", rc(), "drop-line").value;
		expect(v).toMatch(/^[0-9a-f-]{36}$/i);
		expect(v).not.toBe(SID);
	});

	test("multiple placeholders in one value all replaced", () => {
		const ctx = rc();
		expect(renderValue("s={{session_id}};w={{window_id}}", ctx, "drop-line").value).toBe(
			`s=${SID};w=${SID}:0`,
		);
	});

	test("same placeholder is memoized within one render context", () => {
		const ctx = rc();
		const a = renderValue("{{request_id}}", ctx, "drop-line").value;
		const b = renderValue("{{request_id}}", ctx, "drop-line").value;
		expect(a).toBe(b!); // same hook fire → identical
	});

	test("no placeholders → passthrough unchanged", () => {
		expect(renderValue("application/json", rc(), "drop-line").value).toBe("application/json");
	});
});

describe("renderValue — unknown placeholder policy", () => {
	test("drop-line drops the whole value", () => {
		const r = renderValue("{{nope}}", rc(), "drop-line");
		expect(r.value).toBeUndefined();
		expect(r.unknown).toEqual(["nope"]);
	});

	test("keep leaves the original token", () => {
		const r = renderValue("x-{{nope}}", rc(), "keep");
		expect(r.value).toBe("x-{{nope}}");
		expect(r.unknown).toEqual(["nope"]);
	});
});

describe("codex_turn_metadata", () => {
	test("valid compact JSON with capture field order, includes sandbox, omits workspaces", () => {
		const raw = renderValue("{{codex_turn_metadata}}", rc(), "drop-line").value!;
		expect(raw).not.toContain(" "); // compact
		const obj = JSON.parse(raw);

		expect(Object.keys(obj)).toEqual([
			"installation_id",
			"session_id",
			"thread_id",
			"turn_id",
			"window_id",
			"request_kind",
			"thread_source",
			"sandbox",
			"turn_started_at_unix_ms",
		]);
		expect(obj.session_id).toBe(SID);
		expect(obj.thread_id).toBe(SID);
		expect(obj.window_id).toBe(`${SID}:0`);
		expect(obj.request_kind).toBe("turn");
		expect(obj.thread_source).toBe("user");
		expect(obj.sandbox).toBe("windows_sandbox");
		expect(typeof obj.turn_started_at_unix_ms).toBe("number");
		expect(obj).not.toHaveProperty("workspaces");
	});

	test("sandbox value is configurable", () => {
		const raw = renderValue("{{codex_turn_metadata}}", rc("linux_sandbox"), "drop-line").value!;
		expect(JSON.parse(raw).sandbox).toBe("linux_sandbox");
	});

	test("turn_id and session_id differ (turn is per-fire)", () => {
		const raw = renderValue("{{codex_turn_metadata}}", rc(), "drop-line").value!;
		const obj = JSON.parse(raw);
		expect(obj.turn_id).not.toBe(obj.session_id);
		expect(obj.installation_id).toMatch(/^[0-9a-f-]{36}$/i);
	});
});
