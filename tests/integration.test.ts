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
			{ match: { provider: "Axon", modelId: "gpt-5.5" }, template: "codex.headers" },
			{ match: { provider: "Axon", modelIdRegex: "^claude-" }, template: "claude-code.headers" },
		],
		blacklist: ["Authorization", "Content-Length"],
	}),
);
writeFileSync(
	join(extDir, "templates", "codex.headers"),
	[
		"session-id: {{session_id}}",
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
	return (model: unknown, seed: Record<string, string> = {}) => {
		const headers: Record<string, string> = { ...seed };
		const ctx = { model, sessionManager: { getSessionId: () => SID } };
		handler({ headers }, ctx);
		return headers;
	};
}

describe("integration: before_provider_headers", () => {
	const fire = makeHook();

	test("Axon gpt-5.5 → codex headers with dynamic values", () => {
		const h = fire({ provider: "Axon", id: "gpt-5.5" });
		expect(h["session-id"]).toBe(SID);
		expect(h["x-codex-window-id"]).toBe(`${SID}:0`);
		expect(h["originator"]).toBe("codex-tui");
		expect(JSON.parse(h["x-codex-turn-metadata"]!).session_id).toBe(SID);
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

	test("unmatched model → headers untouched (passthrough)", () => {
		const h = fire({ provider: "Axon", id: "deepseek-v4-pro" }, { existing: "1" });
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
