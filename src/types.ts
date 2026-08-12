import type { HeaderLine } from "./template.js";

/** A single match rule: all present fields are ANDed together. */
export interface MatchSpec {
	/** Equality against `ctx.model.provider` (e.g. "Axon"). Case-sensitive. */
	provider?: string;
	/** Equality against `ctx.model.id` (e.g. "gpt-5.5"). Case-sensitive. */
	modelId?: string;
	/** Regex tested against `ctx.model.id` (e.g. "^claude-"). */
	modelIdRegex?: string;
}

/** One ordered rule mapping a match to a template file name. */
export interface Rule {
	match: MatchSpec;
	/** Template file name, e.g. "codex.headers" (resolved under templates/). */
	template: string;
}

/** Fully-normalized config with defaults applied. */
export interface CustomHeaderConfig {
	rules: Rule[];
	/** Header names never written (case-insensitive compare). */
	blacklist: string[];
	/**
	 * Value for the Codex turn-metadata `sandbox` field. Must match the platform
	 * the template's user-agent claims (e.g. `windows_sandbox`, `seatbelt`,
	 * `seccomp`), not necessarily the real host.
	 */
	sandbox: string;
	/** When true, write diagnostics to pi-custom-header.log (tokens redacted). */
	debug: boolean;
}

/** A parsed template: ordered header lines, ready to render. */
export interface ParsedTemplate {
	name: string;
	lines: HeaderLine[];
}
