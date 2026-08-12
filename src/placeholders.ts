import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "uuidv7";
import { getInstallationId } from "./state.js";

/** Fixed value for the Codex turn-metadata `sandbox` field. */
const SANDBOX = "windows_sandbox";

/**
 * Per-hook render context. Placeholder values are memoized here so that every
 * reference within a single hook fire is consistent (e.g. session_id used in
 * several headers resolves once; request_id/turn_id are generated once per fire
 * but stay identical wherever referenced in that fire).
 */
export interface RenderContext {
	ctx: ExtensionContext;
	cache: Map<string, string>;
}

export function createRenderContext(ctx: ExtensionContext): RenderContext {
	return { ctx, cache: new Map() };
}

type Generator = (rc: RenderContext) => string;

function sessionId(rc: RenderContext): string {
	return rc.ctx.sessionManager.getSessionId();
}

/**
 * Codex X-Codex-Turn-Metadata: compact JSON, field order matched to the real
 * capture (references/codex-header.txt:3). Object insertion order IS the output
 * order for JSON.stringify on plain objects, so we build keys in capture order.
 * Deliberately omits `workspaces` (design D2 / out of scope).
 */
function codexTurnMetadata(rc: RenderContext): string {
	const sid = sessionId(rc);
	return JSON.stringify({
		installation_id: getInstallationId(),
		session_id: sid,
		thread_id: sid,
		turn_id: uuidv7(),
		window_id: `${sid}:0`,
		request_kind: "turn",
		thread_source: "user",
		sandbox: SANDBOX,
		turn_started_at_unix_ms: Date.now(),
	});
}

/** Registry of placeholder name → generator. */
const GENERATORS: Record<string, Generator> = {
	session_id: sessionId,
	window_id: (rc) => `${sessionId(rc)}:0`,
	request_id: () => uuidv7(),
	installation_id: () => getInstallationId(),
	codex_turn_metadata: codexTurnMetadata,
};

export function isKnownPlaceholder(name: string): boolean {
	return Object.hasOwn(GENERATORS, name);
}

/**
 * Resolve a single placeholder name to its value, memoized per hook fire.
 * Throws if the name is unknown — callers decide how to handle that.
 */
export function renderPlaceholder(name: string, rc: RenderContext): string {
	const cached = rc.cache.get(name);
	if (cached !== undefined) {
		return cached;
	}

	const generator = GENERATORS[name];
	if (!generator) {
		throw new Error(`unknown placeholder: ${name}`);
	}

	const value = generator(rc);
	rc.cache.set(name, value);
	return value;
}
