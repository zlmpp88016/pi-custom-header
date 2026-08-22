import { expect, test, describe, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the extension at a throwaway agent dir BEFORE importing modules that
// resolve paths at load time.
const tempAgent = mkdtempSync(join(tmpdir(), "pi-custom-header-test-"));
const extDir = join(tempAgent, "extensions", "pi-custom-header");
mkdirSync(join(extDir, "templates"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = tempAgent;

writeFileSync(
	join(extDir, "config.json"),
	JSON.stringify({
		rules: [
			{ match: { provider: "Axon" }, template: "custom.headers" },
			{ match: { provider: "Axon", modelId: "gpt-5.5" }, template: "codex.headers" },
			{ match: { provider: "Axon", modelId: "broken-model" }, template: "missing.headers" },
			{ match: { provider: "Axon", modelIdRegex: "^claude-" }, template: "claude-code.headers" },
		],
		blacklist: ["Authorization", "Content-Length"],
	}),
);
writeFileSync(
	join(extDir, "templates", "codex.headers"),
	[
		"Session_id: {{session_id}}",
		"x-client-request-id: {{request_id}}",
		"x-codex-window-id: {{window_id}}",
		"x-codex-turn-metadata: {{codex_turn_metadata}}",
		"originator: codex-tui",
		"Authorization: Bearer ah-SHOULD-NOT-APPEAR",
	].join("\n"),
);
writeFileSync(
	join(extDir, "templates", "claude-code.headers"),
	["X-Claude-Code-Session-Id: {{session_id}}", "x-app: cli"].join("\n"),
);
writeFileSync(
	join(extDir, "templates", "custom.headers"),
	[
		"User-Agent: ignored-earlier-template-value",
		"user-agent: codex-tui/provider-default",
		"originator: codex-tui",
		"x-user-added-header: enabled",
	].join("\n"),
);

const { default: piCustomHeader } = await import("../src/index.js");

const SID = "019f55eb-f438-7271-b491-87390758c6a2";

function makeHook() {
	let handler: (event: { headers: Record<string, string> }, ctx: unknown) => void = () => {};
	const pi = {
		on(_event: string, h: typeof handler) {
			handler = h;
		},
	};
	piCustomHeader(pi as never);
	return (model: unknown, seed: Record<string, string> = {}, sessionId = SID) => {
		const headers: Record<string, string> = { ...seed };
		const ctx = { model, sessionManager: { getSessionId: () => sessionId } };
		handler({ headers }, ctx);
		return headers;
	};
}

describe("integration: before_provider_headers", () => {
	const fire = makeHook();

	test("Axon gpt-5.5 → model template only, even when provider rule is first", () => {
		const h = fire(
			{ provider: "Axon", id: "gpt-5.5" },
			{
				"SESSION-ID": "old-hyphenated",
				"SESSION_ID": "old-underscored",
			},
		);
		expect(h["session-id"]).toBe(SID);
		expect(Object.keys(h).filter((key) => key.toLowerCase() === "session-id")).toEqual(["session-id"]);
		expect(Object.keys(h).filter((key) => key.toLowerCase() === "session_id")).toEqual([]);
		expect(h["x-client-request-id"]).toBe(SID);
		expect(h["x-codex-window-id"]).toBe(`${SID}:0`);
		expect(h["originator"]).toBe("codex-tui");
		expect(h["x-user-added-header"]).toBeUndefined();
		expect(h["user-agent"]).toBeUndefined();
		expect(JSON.parse(h["x-codex-turn-metadata"]!).session_id).toBe(SID);
	});

	test("legacy request_id stays bound to the session across requests", () => {
		const first = fire({ provider: "Axon", id: "gpt-5.5" }, {}, SID);
		const second = fire({ provider: "Axon", id: "gpt-5.5" }, {}, SID);
		const otherSession = fire({ provider: "Axon", id: "gpt-5.5" }, {}, `${SID}-other`);

		expect(first["x-client-request-id"]).toBe(SID);
		expect(second["x-client-request-id"]).toBe(SID);
		expect(otherSession["x-client-request-id"]).toBe(`${SID}-other`);
	});

	test("Axon claude-opus-4-8 → claude-code headers via regex", () => {
		const h = fire({ provider: "Axon", id: "claude-opus-4-8" });
		expect(h["X-Claude-Code-Session-Id"]).toBe(SID);
		expect(h["x-app"]).toBe("cli");
		expect(h["session-id"]).toBeUndefined(); // did not get codex headers
	});

	test("blacklisted Authorization is never written (real token preserved)", () => {
		const h = fire({ provider: "Axon", id: "gpt-5.5" }, { Authorization: "Bearer real-pi-token" });
		expect(h["Authorization"]).toBe("Bearer real-pi-token");
	});

	test("provider template applies every non-blacklisted line to unmatched Axon models", () => {
		const h = fire(
			{ provider: "Axon", id: "deepseek-v4-pro" },
			{
				existing: "1",
				"User-Agent": "Pi/native",
				"USER-AGENT": "Pi/duplicate",
			},
		);
		expect(h.existing).toBe("1");
		expect(h["user-agent"]).toBe("codex-tui/provider-default");
		expect(h.originator).toBe("codex-tui");
		expect(h["x-user-added-header"]).toBe("enabled");
		expect(Object.keys(h).filter((key) => key.toLowerCase() === "user-agent")).toEqual(["user-agent"]);
	});

	test("unreadable model template passes through without falling back to provider template", () => {
		const h = fire({ provider: "Axon", id: "broken-model" }, { existing: "1" });
		expect(h).toEqual({ existing: "1" });
	});

	test("provider without a matching rule → headers untouched (passthrough)", () => {
		const h = fire({ provider: "Other", id: "deepseek-v4-pro" }, { existing: "1" });
		expect(h).toEqual({ existing: "1" });
	});

	test("undefined model → passthrough", () => {
		const h = fire(undefined, { existing: "1" });
		expect(h).toEqual({ existing: "1" });
	});

	afterAll(() => {
		rmSync(tempAgent, { recursive: true, force: true });
	});
});
