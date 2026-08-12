import { expect, test, describe, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplate } from "../src/config.js";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempAgent = mkdtempSync(join(tmpdir(), "pi-custom-header-template-path-"));
const extDir = join(tempAgent, "extensions", "pi-custom-header");
const subDir = join(extDir, "templates");
mkdirSync(subDir, { recursive: true });

// Other test files also redirect the agent dir; re-point it before each test so
// this file works regardless of load order.
beforeEach(() => {
	process.env.PI_CODING_AGENT_DIR = tempAgent;
});

afterAll(() => {
	if (previousAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	rmSync(tempAgent, { recursive: true, force: true });
});

describe("template path resolution", () => {
	test("user extension root wins over templates/ subdir", () => {
		writeFileSync(join(extDir, "precedence.headers"), "x-source: flat-root");
		writeFileSync(join(subDir, "precedence.headers"), "x-source: templates-subdir");

		const parsed = loadTemplate("precedence.headers");
		expect(parsed?.lines).toEqual([{ key: "x-source", rawValue: "flat-root" }]);
	});

	test("templates/ subdir still works when the root has no copy", () => {
		writeFileSync(join(subDir, "subdir-only.headers"), "x-source: templates-subdir");

		const parsed = loadTemplate("subdir-only.headers");
		expect(parsed?.lines).toEqual([{ key: "x-source", rawValue: "templates-subdir" }]);
	});

	test("falls back to the bundled template when the user dir has none", () => {
		const parsed = loadTemplate("codex.headers");
		const beta = parsed?.lines.find((line) => line.key === "x-codex-beta-features");
		expect(beta?.rawValue).toBe("remote_compaction_v2");
	});

	test("returns null when no location has the template", () => {
		expect(loadTemplate("no-such-template.headers")).toBeNull();
	});

	test("cache follows the resolved path, not just the name", () => {
		const rootCopy = join(extDir, "cache-check.headers");
		writeFileSync(rootCopy, "x-source: flat-root");
		writeFileSync(join(subDir, "cache-check.headers"), "x-source: templates-subdir");
		expect(loadTemplate("cache-check.headers")?.lines[0]?.rawValue).toBe("flat-root");

		rmSync(rootCopy);
		expect(loadTemplate("cache-check.headers")?.lines[0]?.rawValue).toBe("templates-subdir");
	});
});
