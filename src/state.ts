import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveExtensionUserDir } from "./agent-dir.js";
import { logDebug } from "./logger.js";

const INSTALLATION_ID_FILE = "installation-id";

/** Basic UUID v4 shape check to reject a corrupted persisted value. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedInstallationId: string | undefined;

function installationIdPath(): string {
	return join(resolveExtensionUserDir(), INSTALLATION_ID_FILE);
}

/**
 * Machine-level stable identifier, persisted in the user extension directory
 * (outside any project repository — see design.md §4.5).
 *
 * First run generates a UUID v4 and writes it; later runs reuse it. Read/write
 * failure falls back to an in-process value (not persisted) and never throws,
 * so a locked-down filesystem cannot block requests.
 */
export function getInstallationId(): string {
	if (cachedInstallationId) {
		return cachedInstallationId;
	}

	const path = installationIdPath();

	try {
		if (existsSync(path)) {
			const value = readFileSync(path, "utf8").trim();
			if (UUID_RE.test(value)) {
				cachedInstallationId = value;
				return value;
			}
			logDebug(`installation-id file is malformed, regenerating: ${path}`);
		}
	} catch (error) {
		logDebug("failed to read installation-id, will try to regenerate", error);
	}

	const generated = crypto.randomUUID();

	try {
		writeFileSync(path, generated, "utf8");
		cachedInstallationId = generated;
	} catch (error) {
		// Persistence failed (e.g. dir missing / read-only). Use the value for this
		// process only; do not cache-as-persisted so a later run can retry writing.
		logDebug("failed to persist installation-id; using in-process value", error);
		cachedInstallationId = generated;
	}

	return generated;
}
