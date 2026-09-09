import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { registerTeammateChildExtension, getExtensionEntryPath } from "../src/teammate.js";
import { createRenderContext, renderPlaceholder } from "../src/placeholders.js";
import { recordActiveMainSession, resolveMainSessionId, MAIN_SESSION_ENV } from "../src/session-cache.js";

const TEAMMATE_CHILD_EXTENSIONS_KEY = Symbol.for("pi-maestro-teammate.child-extensions");

describe("teammate child extension registration", () => {
	test("getExtensionEntryPath resolves entry file", () => {
		const entryPath = getExtensionEntryPath();
		expect(typeof entryPath).toBe("string");
		expect(entryPath.length).toBeGreaterThan(0);
		expect(entryPath.endsWith(".ts") || entryPath.endsWith(".js")).toBe(true);
	});

	test("registerTeammateChildExtension sets registry on globalThis", () => {
		const success = registerTeammateChildExtension("/custom/test/path/index.ts");
		expect(success).toBe(true);

		const globals = globalThis as typeof globalThis & Record<symbol, any>;
		const registry = globals[TEAMMATE_CHILD_EXTENSIONS_KEY];
		expect(registry).toBeDefined();
		expect(registry.registrations).toBeDefined();

		const registrations = [...registry.registrations.values()];
		const found = registrations.find((r: any) => r.path === "/custom/test/path/index.ts");
		expect(found).toBeDefined();
		expect(found.tools).toEqual([]);
	});
});

describe("teammate session inheritance", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.PI_TEAMMATE_CHILD;
		delete process.env[MAIN_SESSION_ENV];
		delete process.env.PI_MAIN_SESSION_ID;
		delete process.env.PI_PARENT_SESSION_ID;
		delete process.env.PI_TEAMMATE_PARENT_SESSION;
		delete process.env.PI_TEAMMATE_CORRELATION_ID;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	const mockContext = (sessionId = "child-session-123"): any => ({
		sessionManager: {
			getSessionId: () => sessionId,
			getSessionFile: () => `/path/to/${sessionId}.jsonl`,
		},
		cwd: "/test/workspace",
	});

	test("main process uses its own session ID", () => {
		const ctx = mockContext("main-session-001");
		const rc = createRenderContext(ctx, "windows_sandbox", true);

		expect(renderPlaceholder("session_id", rc)).toBe("main-session-001");
		expect(renderPlaceholder("parent_session_id", rc)).toBe("main-session-001");
		expect(renderPlaceholder("is_teammate", rc)).toBe("false");
	});

	test("child process inherits main session ID via env var", () => {
		process.env.PI_TEAMMATE_CHILD = "1";
		process.env[MAIN_SESSION_ENV] = "main-session-999";
		process.env.PI_TEAMMATE_CORRELATION_ID = "corr-abc";

		const ctx = mockContext("child-agent-777");
		const rc = createRenderContext(ctx, "windows_sandbox", true);

		// session_id must match main task to hit backend cache
		expect(renderPlaceholder("session_id", rc)).toBe("main-session-999");
		expect(renderPlaceholder("parent_session_id", rc)).toBe("main-session-999");
		// child_session_id exposes child's own ID
		expect(renderPlaceholder("child_session_id", rc)).toBe("child-agent-777");
		expect(renderPlaceholder("correlation_id", rc)).toBe("corr-abc");
		expect(renderPlaceholder("is_teammate", rc)).toBe("true");
	});

	test("child process extracts main session ID from PI_TEAMMATE_PARENT_SESSION filename", () => {
		process.env.PI_TEAMMATE_CHILD = "1";
		process.env.PI_TEAMMATE_PARENT_SESSION = "C:\\Users\\user\\.pi\\agent\\sessions\\--path--\\2026-09-08T02-51-59_01a07eed-f6ac-71fc-9bd5-8eb1eded847d.jsonl";

		const ctx = mockContext("child-agent-888");
		const rc = createRenderContext(ctx, "windows_sandbox", true);

		expect(renderPlaceholder("session_id", rc)).toBe("01a07eed-f6ac-71fc-9bd5-8eb1eded847d");
		expect(renderPlaceholder("parent_session_id", rc)).toBe("01a07eed-f6ac-71fc-9bd5-8eb1eded847d");
	});

	test("inheritParentSession=false disables inheritance in child process", () => {
		process.env.PI_TEAMMATE_CHILD = "1";
		process.env[MAIN_SESSION_ENV] = "main-session-999";

		const ctx = mockContext("child-agent-777");
		const rc = createRenderContext(ctx, "windows_sandbox", false);

		// When inheritParentSession is false, session_id stays child's own
		expect(renderPlaceholder("session_id", rc)).toBe("child-agent-777");
		// parent_session_id still resolves the parent
		expect(renderPlaceholder("parent_session_id", rc)).toBe("main-session-999");
	});
});

