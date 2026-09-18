import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRandomValues } from "node:crypto";
import { resolveExtensionUserDir } from "./agent-dir.js";
import { logDebug } from "./logger.js";

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SESSIONS_CACHE_FILE = "opencode-sessions.json";
export const OPENCODE_SESSION_ENV = "PI_CUSTOM_HEADER_OPENCODE_SESSION";

let lastTs = 0;
let counter = 0;

/** In-memory cache: parentSessionId -> x-opencode-session value ("ses_...") */
const sessionMemoryCache = new Map<string, string>();

/**
 * Generate an OpenCode-style 26-character identifier (12 hex chars + 14 Base62 chars).
 * - desc=true: bitwise NOT applied to (ts * 4096 + ctr), producing lexicographically descending values.
 * - desc=false: normal (ts * 4096 + ctr), producing lexicographically ascending values.
 */
export function generateOpencodeId(desc: boolean, customTs?: number): string {
	const ts = customTs ?? Date.now();
	if (ts !== lastTs) {
		counter = 1;
		lastTs = ts;
	} else {
		counter = (counter + 1) & 0xfff;
	}

	let v = BigInt(ts) * 0x1000n + BigInt(counter);
	if (desc) {
		v = ~v;
	}

	let time = "";
	for (let i = 0; i < 6; i++) {
		const shift = BigInt(40 - 8 * i);
		const byteVal = Number((v >> shift) & 0xffn);
		time += byteVal.toString(16).padStart(2, "0");
	}

	const randomBytes = new Uint8Array(14);
	getRandomValues(randomBytes);
	let rnd = "";
	for (let i = 0; i < 14; i++) {
		rnd += BASE62_CHARS[randomBytes[i]! % 62];
	}

	return time + rnd;
}

function getDiskCachePath(): string {
	return join(resolveExtensionUserDir(), SESSIONS_CACHE_FILE);
}

function readDiskCache(): Record<string, { sessionId: string; updatedAt: number }> {
	try {
		const filePath = getDiskCachePath();
		if (existsSync(filePath)) {
			const text = readFileSync(filePath, "utf8");
			const parsed = JSON.parse(text);
			if (typeof parsed === "object" && parsed !== null) {
				return parsed as Record<string, { sessionId: string; updatedAt: number }>;
			}
		}
	} catch (error) {
		logDebug("failed to read opencode sessions disk cache", error);
	}
	return {};
}

function writeDiskCache(cache: Record<string, { sessionId: string; updatedAt: number }>): void {
	try {
		const filePath = getDiskCachePath();
		writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
	} catch (error) {
		logDebug("failed to write opencode sessions disk cache", error);
	}
}

/**
 * Resolve or create the x-opencode-session header value ("ses_...").
 *
 * Guarantees session cache consistency: if parentSessionId is the same,
 * the returned x-opencode-session is guaranteed to be identical across requests
 * and teammate child processes, enabling cache hits on OpenCode.
 */
export function getOpencodeSessionId(parentSessionId?: string, _cwd?: string): string {
	const key = (parentSessionId && parentSessionId.trim()) || "default";

	// 1. In-memory cache
	const memoryVal = sessionMemoryCache.get(key);
	if (memoryVal) {
		return memoryVal;
	}

	// 2. Disk cache (for cross-process child agents or revived sessions)
	const diskData = readDiskCache();
	if (diskData[key]?.sessionId) {
		const cachedSid = diskData[key].sessionId;
		sessionMemoryCache.set(key, cachedSid);
		process.env[OPENCODE_SESSION_ENV] = cachedSid;
		return cachedSid;
	}

	// 3. Fallback to env var if child process and key is default/current
	if (process.env[OPENCODE_SESSION_ENV] && key === "default") {
		return process.env[OPENCODE_SESSION_ENV];
	}

	// 4. Generate new session ID
	const newSid = "ses_" + generateOpencodeId(true);
	sessionMemoryCache.set(key, newSid);
	process.env[OPENCODE_SESSION_ENV] = newSid;

	// Persist to disk
	diskData[key] = {
		sessionId: newSid,
		updatedAt: Date.now(),
	};
	writeDiskCache(diskData);

	return newSid;
}

/**
 * Generate a new x-opencode-request header value ("msg_...").
 * Each call generates a freshly incremented/randomized message identifier.
 */
export function getOpencodeRequestId(): string {
	return "msg_" + generateOpencodeId(false);
}

/**
 * Clear the in-memory session cache (used primarily for testing).
 */
export function clearOpencodeSessionCache(): void {
	sessionMemoryCache.clear();
	delete process.env[OPENCODE_SESSION_ENV];
}
