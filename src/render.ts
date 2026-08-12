import { isKnownPlaceholder, renderPlaceholder, type RenderContext } from "./placeholders.js";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export interface RenderResult {
	/** The resolved value, or undefined if the whole line should be dropped. */
	value: string | undefined;
	/** Placeholder names that had no generator. */
	unknown: string[];
}

/**
 * Replace every `{{placeholder}}` in a raw value.
 *
 * - Known placeholders are resolved (memoized per hook fire).
 * - Unknown placeholders drop the whole line (returns value: undefined) to
 *   avoid emitting an invalid literal.
 * - A value with no placeholders passes through unchanged.
 */
export function renderValue(rawValue: string, rc: RenderContext): RenderResult {
	const unknown: string[] = [];

	const value = rawValue.replace(PLACEHOLDER_RE, (whole, name: string) => {
		if (isKnownPlaceholder(name)) {
			return renderPlaceholder(name, rc);
		}
		unknown.push(name);
		return whole;
	});

	if (unknown.length > 0) {
		return { value: undefined, unknown };
	}

	return { value, unknown };
}
