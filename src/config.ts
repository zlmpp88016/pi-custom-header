import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExtensionUserDir } from "./agent-dir.js";
import { logDebug } from "./logger.js";
import { parseHeaderTemplate } from "./template.js";
import type {
	CustomHeaderConfig,
	MatchSpec,
	ParsedTemplate,
	Rule,
	UnknownPlaceholderMode,
} from "./types.js";

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

const DEFAULT_CONFIG: CustomHeaderConfig = {
	rules: [],
	blacklist: DEFAULT_BLACKLIST,
	unknownPlaceholder: "drop-line",
	sandbox: "windows_sandbox",
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

function normalizeUnknownPlaceholder(raw: unknown): UnknownPlaceholderMode {
	return raw === "keep" ? "keep" : "drop-line";
}

export function normalizeConfig(raw: unknown): CustomHeaderConfig {
	if (!isRecord(raw)) {
		return { ...DEFAULT_CONFIG, blacklist: [...DEFAULT_BLACKLIST] };
	}
	return {
		rules: normalizeRules(raw.rules),
		blacklist: normalizeBlacklist(raw.blacklist),
		unknownPlaceholder: normalizeUnknownPlaceholder(raw.unknownPlaceholder),
		sandbox: toStringOrUndefined(raw.sandbox) ?? DEFAULT_CONFIG.sandbox,
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
		config = { ...DEFAULT_CONFIG, blacklist: [...DEFAULT_BLACKLIST] };
	} else {
		try {
			const rawText = readFileSync(path, "utf8");
			config = normalizeConfig(JSON.parse(rawText));
		} catch (error) {
			logDebug(`failed to parse ${path}, using defaults (headers unchanged)`, error);
			config = { ...DEFAULT_CONFIG, blacklist: [...DEFAULT_BLACKLIST] };
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

function resolveTemplatePath(name: string): string | undefined {
	const userPath = join(resolveExtensionUserDir(), TEMPLATES_DIR_NAME, name);
	if (existsSync(userPath)) {
		return userPath;
	}
	const bundledPath = join(BUNDLED_TEMPLATES_DIR, name);
	if (existsSync(bundledPath)) {
		return bundledPath;
	}
	return undefined;
}

/**
 * Load and parse a template by file name. User dir overrides bundled default.
 * Returns null if not found or unreadable (caller → transparent passthrough).
 * Cached by path+fingerprint so /reload picks up edits.
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
