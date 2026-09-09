import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "uuidv7";
import { getInstallationId } from "./state.js";

/**
 * Per-hook render context. Placeholder values are memoized here so that every
 * reference within a single hook fire is consistent (e.g. session_id used in
 * several headers resolves once; the legacy request_id alias resolves to the
 * same session id, while turn_id is generated once per fire).
 */
export interface RenderContext {
	ctx: ExtensionContext;
	/** Codex turn-metadata `sandbox` value (config `sandbox`). */
	sandbox: string;
	cache: Map<string, string>;
}

export function createRenderContext(ctx: ExtensionContext, sandbox: string): RenderContext {
	return { ctx, sandbox, cache: new Map() };
}

type Generator = (rc: RenderContext) => string;

function sessionId(rc: RenderContext): string {
	try {
		return rc.ctx.sessionManager?.getSessionId?.() ?? "";
	} catch {
		return "";
	}
}

function parentSessionId(rc: RenderContext): string {
	const parentSessionFile = process.env.PI_TEAMMATE_PARENT_SESSION;
	if (parentSessionFile) {
		const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-zA-Z_-]{8,})\.jsonl$/i.exec(parentSessionFile);
		if (match && match[1]) {
			const parts = match[1].split("_");
			return parts[parts.length - 1];
		}
	}
	return sessionId(rc);
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
		sandbox: rc.sandbox,
		turn_started_at_unix_ms: Date.now(),
	});
}

/** Registry of placeholder name → generator. */
const GENERATORS: Record<string, Generator> = {
	session_id: sessionId,
	parent_session_id: parentSessionId,
	correlation_id: () => process.env.PI_TEAMMATE_CORRELATION_ID ?? "",
	is_teammate: () => (process.env.PI_TEAMMATE_CHILD === "1" ? "true" : "false"),
	window_id: (rc) => `${sessionId(rc)}:0`,
	// Compatibility alias for older templates. Codex binds this value to the
	// session rather than generating a new id for every provider request.
	request_id: sessionId,
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
