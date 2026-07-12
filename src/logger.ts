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

function redact(value: string): string {
	return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

const LOG_FILE = join(resolveExtensionUserDir(), "pi-custom-header.log");

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Best-effort, fire-and-forget diagnostic logger.
 * Never throws and never blocks the header hook — logging failures are swallowed.
 * Only writes when the log file's directory already exists (the user extension
 * dir); it does not create directories, to avoid surprising side effects.
 */
export function logDebug(message: string, error?: unknown): void {
	try {
		const errorText =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: error === undefined
					? ""
					: String(error);
		const suffix = errorText ? ` ${redact(errorText)}` : "";
		const line = `${new Date().toISOString()} ${redact(message)}${suffix}\n`;
		writeQueue = writeQueue.then(
			() => appendFile(LOG_FILE, line, "utf8").catch(() => undefined),
			() => appendFile(LOG_FILE, line, "utf8").catch(() => undefined),
		);
		void writeQueue.catch(() => undefined);
	} catch {
		// Diagnostics must never affect extension behavior.
	}
}
