import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveExtensionUserDir } from "./agent-dir.js";

/**
 * Redact anything that looks like a bearer token / API key / JWT before it can
 * reach a log line. Security red line: this extension handles templates that may
 * contain real `Authorization: Bearer ...` values, and they must never be logged.
 */
const SECRET_VALUE_PATTERN =
	/\b(?:Bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9_-]{12,}|ah-[A-Za-z0-9]{16,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{12,})\b/g;

/** Exported for tests. Replaces token-shaped substrings with `[REDACTED]`. */
export function redactSecrets(value: string): string {
	return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

const LOG_FILE = join(resolveExtensionUserDir(), "pi-custom-header.log");

// Off by default. Gated by the config `debug` flag; set once per hook fire.
let debugEnabled = false;

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Enable/disable diagnostic logging. Driven by config `debug`; the hook sets it
 * from the freshly-loaded config on each fire. When disabled, `logDebug` is a
 * no-op, so the extension writes nothing by default (zero side effects).
 */
export function setDebugEnabled(enabled: boolean): void {
	debugEnabled = enabled;
}

export function isDebugEnabled(): boolean {
	return debugEnabled;
}

/**
 * Best-effort, fire-and-forget diagnostic logger. No-op unless debug is on.
 * Never throws and never blocks the header hook — logging failures are swallowed.
 * Does not create directories; it only appends to the log file in the user
 * extension dir (which exists once the user has placed their config there).
 */
export function logDebug(message: string, error?: unknown): void {
	if (!debugEnabled) {
		return;
	}
	try {
		const errorText =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: error === undefined
					? ""
					: String(error);
		const suffix = errorText ? ` ${redactSecrets(errorText)}` : "";
		const line = `${new Date().toISOString()} ${redactSecrets(message)}${suffix}\n`;
		writeQueue = writeQueue.then(
			() => appendFile(LOG_FILE, line, "utf8").catch(() => undefined),
			() => appendFile(LOG_FILE, line, "utf8").catch(() => undefined),
		);
		void writeQueue.catch(() => undefined);
	} catch {
		// Diagnostics must never affect extension behavior.
	}
}
