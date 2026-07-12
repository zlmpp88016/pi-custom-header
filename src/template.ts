/** One parsed header line, preserving original key casing and order. */
export interface HeaderLine {
	key: string;
	/** Raw value, may contain `{{placeholder}}` tokens and literal `:` chars. */
	rawValue: string;
}

/**
 * Parse raw HTTP header text into an ordered list of header lines.
 *
 * Rules (see design.md §4.1):
 * - One header per line, split on the FIRST `:` only (values may contain `:`,
 *   e.g. URLs or JSON such as x-codex-turn-metadata).
 * - Key and value are trimmed; original key casing is preserved for byte-level
 *   fidelity with captured traffic.
 * - Blank lines and `#` comment lines are ignored.
 * - A line without a `:` is skipped (it is not a valid header).
 * - Order is preserved to ease diffing against captures.
 */
export function parseHeaderTemplate(text: string): HeaderLine[] {
	const lines: HeaderLine[] = [];

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}

		const colonIndex = line.indexOf(":");
		if (colonIndex <= 0) {
			// No colon, or line starts with a colon → not a valid header line.
			continue;
		}

		const key = line.slice(0, colonIndex).trim();
		const rawValue = line.slice(colonIndex + 1).trim();
		if (key.length === 0) {
			continue;
		}

		lines.push({ key, rawValue });
	}

	return lines;
}
