import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logDebug } from "./logger.js";

const TEAMMATE_CHILD_EXTENSIONS_KEY = Symbol.for("pi-maestro-teammate.child-extensions");

interface TeammateChildExtensionRegistration {
	path: string;
	tools: readonly string[];
}

interface ChildExtensionRegistry {
	registrations: Map<symbol, TeammateChildExtensionRegistration>;
	[key: string]: unknown;
}

/**
 * Resolves the absolute file path to the extension's entrypoint (`index.ts` or `src/index.ts`).
 */
export function getExtensionEntryPath(): string {
	try {
		const rootIndexTs = fileURLToPath(new URL("../index.ts", import.meta.url));
		if (existsSync(rootIndexTs)) {
			return rootIndexTs;
		}
		const rootIndexJs = fileURLToPath(new URL("../index.js", import.meta.url));
		if (existsSync(rootIndexJs)) {
			return rootIndexJs;
		}
	} catch {
		// Fall through
	}
	return fileURLToPath(import.meta.url);
}

/**
 * Registers this extension in pi-maestro-teammate's child extensions registry.
 *
 * pi-maestro-teammate spawns child agent processes with `--no-extensions`,
 * passing only explicitly registered extensions via `--extension <path>`.
 * By registering our entry path into the cross-package globalThis registry,
 * any teammate subagent child process will automatically load pi-custom-header.
 */
export function registerTeammateChildExtension(customEntryPath?: string): boolean {
	const entryPath = (customEntryPath ?? getExtensionEntryPath()).trim();
	if (!entryPath) return false;

	try {
		const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
		let registry = globals[TEAMMATE_CHILD_EXTENSIONS_KEY] as ChildExtensionRegistry | undefined;

		if (!registry) {
			registry = {
				registrations: new Map(),
			};
			globals[TEAMMATE_CHILD_EXTENSIONS_KEY] = registry;
		}

		if (!registry.registrations) {
			registry.registrations = new Map();
		}

		const pathKey = (val: string) => (process.platform === "win32" ? val.toLowerCase() : val);
		const targetKey = pathKey(entryPath);

		// Remove any existing registration for the same path
		for (const [existingToken, reg] of registry.registrations) {
			if (pathKey(reg.path) === targetKey) {
				registry.registrations.delete(existingToken);
			}
		}

		const token = Symbol(entryPath);
		registry.registrations.set(token, {
			path: entryPath,
			tools: [],
		});

		logDebug(`registered teammate child extension: ${entryPath}`);
		return true;
	} catch (error) {
		logDebug("failed to register teammate child extension", error);
		return false;
	}
}
