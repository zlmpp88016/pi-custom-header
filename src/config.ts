import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExtensionUserDir } from "./agent-dir.js";
import { logDebug, setDebugEnabled } from "./logger.js";
import { parseHeaderTemplate } from "./template.js";
import type { CustomHeaderConfig, MatchSpec, ParsedTemplate, Rule } from "./types.js";

// Package root = one level up from src/ (this file lives in src/).
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_TEMPLATES_DIR = join(PACKAGE_ROOT, "templates");

const CONFIG_FILE_NAME = "config.json";
const TEMPLATES_DIR_NAME = "templates";

const DEFAULT_BLACKLIST = [
	"Authorization",
	"Content-Length",
	"Host",
	"Content-Encoding",
	"Connection",
	"Accept-Encoding",
];

const DEFAULT_SANDBOX = "windows_sandbox";

const DEFAULT_CONFIG: CustomHeaderConfig = {
	rules: [],
	blacklist: DEFAULT_BLACKLIST,
	sandbox: DEFAULT_SANDBOX,
	teammate: true,
	inheritParentSession: true,
	debug: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeMatch(raw: unknown): MatchSpec {
	if (!isRecord(raw)) {
		return {};
	}
	const match: MatchSpec = {};
	const provider = toStringOrUndefined(raw.provider);
	const modelId = toStringOrUndefined(raw.modelId);
	const modelIdRegex = toStringOrUndefined(raw.modelIdRegex);
	if (provider !== undefined) match.provider = provider;
	if (modelId !== undefined) match.modelId = modelId;
	if (modelIdRegex !== undefined) match.modelIdRegex = modelIdRegex;
	return match;
}

function normalizeRules(raw: unknown): Rule[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const rules: Rule[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) {
			continue;
		}
		const template = toStringOrUndefined(entry.template);
		if (template === undefined) {
			logDebug("skipping rule with missing/invalid template");
			continue;
		}
		rules.push({ match: normalizeMatch(entry.match), template });
	}
	return rules;
}

function normalizeBlacklist(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return DEFAULT_BLACKLIST;
	}
	const list = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
	return list.length > 0 ? list : DEFAULT_BLACKLIST;
}

/** Fresh copy of defaults with an independent blacklist array. */
function cloneDefaults(): CustomHeaderConfig {
	return { ...DEFAULT_CONFIG, blacklist: [...DEFAULT_BLACKLIST] };
}

export function normalizeConfig(raw: unknown): CustomHeaderConfig {
	if (!isRecord(raw)) {
		return cloneDefaults();
	}
	return {
		rules: normalizeRules(raw.rules),
		blacklist: normalizeBlacklist(raw.blacklist),
		sandbox: toStringOrUndefined(raw.sandbox) ?? DEFAULT_SANDBOX,
		teammate: raw.teammate !== false,
		inheritParentSession: raw.inheritParentSession !== false,
		debug: raw.debug === true,
	};
}

// ── Config loading with mtime+size fingerprint cache ──────────────────────

function fingerprint(path: string): string {
	try {
		const stats = statSync(path);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return "missing";
	}
}

let cachedConfigFingerprint: string | undefined;
let cachedConfig: CustomHeaderConfig | undefined;

function userConfigPath(): string {
	return join(resolveExtensionUserDir(), CONFIG_FILE_NAME);
}

/**
 * Load and normalize config.json from the user extension directory.
 * Missing file → defaults (empty rules → transparent passthrough for all).
 * Parse error → defaults + logged (never throws).
 */
export function loadConfig(): CustomHeaderConfig {
	const path = userConfigPath();
	const fp = fingerprint(path);
	if (cachedConfig && cachedConfigFingerprint === fp) {
		return cachedConfig;
	}

	let config: CustomHeaderConfig;
	if (!existsSync(path)) {
		config = cloneDefaults();
	} else {
		let rawText = "";
		try {
			rawText = readFileSync(path, "utf8");
			config = normalizeConfig(JSON.parse(rawText));
		} catch (error) {
			// The JSON is broken so we can't parse `debug`, but if the raw text asks
			// for debug, enable it so this very error gets logged for the user.
			if (/"debug"\s*:\s*true/.test(rawText)) {
				setDebugEnabled(true);
			}
			logDebug(`failed to parse ${path}, using defaults (headers unchanged)`, error);
			config = cloneDefaults();
		}
	}

	cachedConfigFingerprint = fp;
	cachedConfig = config;
	return config;
}

// ── Template loading: user dir first, fall back to bundled ────────────────

interface CachedTemplate {
	fingerprint: string;
	parsed: ParsedTemplate;
}

const templateCache = new Map<string, CachedTemplate>();

/**
 * Locate a template file, first match wins:
 * 1. User extension dir, flat — alongside config.json and installation-id.
 *    This is the documented place to edit templates.
 * 2. User extension dir, under templates/ — kept for setups created before the
 *    flat layout.
 * 3. Bundled with the package.
 */
function resolveTemplatePath(name: string): string | undefined {
	const userDir = resolveExtensionUserDir();
	const candidates = [
		join(userDir, name),
		join(userDir, TEMPLATES_DIR_NAME, name),
		join(BUNDLED_TEMPLATES_DIR, name),
	];
	return candidates.find((path) => existsSync(path));
}

/**
 * Load and parse a template by file name. A template in the user extension dir
 * (flat, or under templates/) overrides the bundled default.
 * Returns null if not found or unreadable (caller → transparent passthrough).
 * Cached by path+fingerprint so /reload picks up both edits and moves between
 * those locations.
 */
export function loadTemplate(name: string): ParsedTemplate | null {
	const path = resolveTemplatePath(name);
	if (path === undefined) {
		logDebug(`template not found (user or bundled): ${name}`);
		return null;
	}

	const fp = `${path}#${fingerprint(path)}`;
	const cached = templateCache.get(name);
	if (cached && cached.fingerprint === fp) {
		return cached.parsed;
	}

	try {
		const text = readFileSync(path, "utf8");
		const parsed: ParsedTemplate = { name, lines: parseHeaderTemplate(text) };
		templateCache.set(name, { fingerprint: fp, parsed });
		return parsed;
	} catch (error) {
		logDebug(`failed to read template ${name} at ${path}`, error);
		return null;
	}
}
