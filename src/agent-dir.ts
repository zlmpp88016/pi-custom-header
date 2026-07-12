import { homedir } from "node:os";
import { join } from "node:path";

const PI_AGENT_DIR_ENV_VAR = "PI_CODING_AGENT_DIR";

interface AgentDirEnvironment {
	[name: string]: string | undefined;
}

function expandHomeDirectory(configuredDir: string, homeDirectory: string): string {
	if (configuredDir === "~") {
		return homeDirectory;
	}

	if (configuredDir.startsWith("~/") || configuredDir.startsWith("~\\")) {
		return join(homeDirectory, configuredDir.slice(2));
	}

	return configuredDir;
}

/**
 * Resolve the pi agent directory (`~/.pi/agent` by default).
 * Honors the `PI_CODING_AGENT_DIR` override, matching pi's own resolution and
 * the convention used by sibling extensions such as pi-tool-display.
 */
export function resolvePiAgentDir(
	env: AgentDirEnvironment = process.env,
	homeDirectory = homedir(),
): string {
	const configuredDir = env[PI_AGENT_DIR_ENV_VAR];
	if (!configuredDir) {
		return join(homeDirectory, ".pi", "agent");
	}

	return expandHomeDirectory(configuredDir, homeDirectory);
}

/** Extension name — also the folder name under `~/.pi/agent/extensions/`. */
export const EXTENSION_NAME = "pi-custom-header";

/** User config/template directory: `~/.pi/agent/extensions/pi-custom-header/`. */
export function resolveExtensionUserDir(
	env: AgentDirEnvironment = process.env,
	homeDirectory = homedir(),
): string {
	return join(resolvePiAgentDir(env, homeDirectory), "extensions", EXTENSION_NAME);
}
