import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveExtensionUserDir } from "./agent-dir.js";
import { logDebug } from "./logger.js";
import type { RenderContext } from "./placeholders.js";

export const MAIN_SESSION_ENV = "PI_CUSTOM_HEADER_MAIN_SESSION_ID";
export const ALT_MAIN_SESSION_ENV = "PI_MAIN_SESSION_ID";
export const PARENT_SESSION_ENV = "PI_PARENT_SESSION_ID";

/** Memory cache for this process */
let memoryMainSessionId: string | undefined;

function getCacheKeyForCwd(cwd?: string): string {
	if (!cwd) return "default";
	return createHash("sha256").update(cwd.toLowerCase().replace(/\\/g, "/")).digest("hex").slice(0, 16);
}

function getActiveSessionFilePath(cwd?: string): string {
	const userDir = resolveExtensionUserDir();
	const key = getCacheKeyForCwd(cwd);
	return join(userDir, `active-session-${key}.json`);
}

/**
 * Record the active main session ID in the parent process.
 * Stores into memory, environment variables (inherited by spawned child processes),
 * and disk cache.
 */
export function recordActiveMainSession(sessionId: string, cwd?: string): void {
	const trimmed = sessionId?.trim();
	if (!trimmed) {
		return;
	}

	// Do not let a child process overwrite the main session ID
	if (process.env.PI_TEAMMATE_CHILD === "1") {
		return;
	}

	memoryMainSessionId = trimmed;

	// Export to process.env so any crossSpawn(... { env: process.env }) inherits it
	process.env[MAIN_SESSION_ENV] = trimmed;
	process.env[ALT_MAIN_SESSION_ENV] = trimmed;

	// Persist to user extension directory as cross-process backup
	try {
		const filePath = getActiveSessionFilePath(cwd);
		const payload = {
			sessionId: trimmed,
			cwd: cwd ?? "",
			pid: process.pid,
			updatedAt: Date.now(),
		};
		writeFileSync(filePath, JSON.stringify(payload), "utf8");
	} catch (error) {
		logDebug("failed to persist active session cache", error);
	}
}

/**
 * Resolve the main/parent task's session ID.
 * Tries inherited environment variables, teammate's parent session file,
 * workspace disk cache, and finally falls back to current session.
 */
export function resolveMainSessionId(rc?: RenderContext): string {
	// 1. Inherited process.env (fastest and most accurate for child processes)
	const envSid = process.env[MAIN_SESSION_ENV] || process.env[ALT_MAIN_SESSION_ENV] || process.env[PARENT_SESSION_ENV];
	if (envSid && envSid.trim().length > 0) {
		return envSid.trim();
	}

	// 2. In-process memory cache if present
	if (memoryMainSessionId && memoryMainSessionId.trim().length > 0) {
		return memoryMainSessionId.trim();
	}

	// 3. PI_TEAMMATE_PARENT_SESSION set by pi-maestro-teammate
	const parentSessionFile = process.env.PI_TEAMMATE_PARENT_SESSION;
	if (parentSessionFile) {
		// 3.1 Try reading the first line of the parent session jsonl file
		try {
			if (existsSync(parentSessionFile)) {
				const content = readFileSync(parentSessionFile, "utf8");
				const firstLine = content.split("\n", 1)[0]?.trim();
				if (firstLine) {
					const parsed = JSON.parse(firstLine);
					if (parsed && typeof parsed.id === "string" && parsed.id.trim().length > 0) {
						return parsed.id.trim();
					}
				}
			}
		} catch {
			// Fall back to filename extraction
		}

		// 3.2 Extract session ID from parent session filename
		// e.g. 2026-09-08T02-51-59-532Z_01a07eed-f6ac-71fc-9bd5-8eb1eded847d.jsonl
		const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-zA-Z_-]{16,})\.jsonl$/i.exec(parentSessionFile);
		if (match && match[1]) {
			const parts = match[1].split("_");
			const candidate = parts[parts.length - 1];
			if (candidate) {
				return candidate;
			}
		}
	}

	// 4. Workspace session cache file in ~/.pi/agent/extensions/pi-custom-header/
	try {
		const filePath = getActiveSessionFilePath(rc?.ctx?.cwd);
		if (existsSync(filePath)) {
			const content = readFileSync(filePath, "utf8");
			const parsed = JSON.parse(content);
			if (parsed && typeof parsed.sessionId === "string" && parsed.sessionId.trim().length > 0) {
				return parsed.sessionId.trim();
			}
		}
	} catch {
		// Ignore disk cache read failure
	}

	// 5. Fallback: current session manager's session ID
	try {
		return rc?.ctx?.sessionManager?.getSessionId?.() ?? "";
	} catch {
		return "";
	}
}
