import { logDebug } from "./logger.js";
import type { MatchSpec, Rule } from "./types.js";

/** Minimal shape we read off ctx.model (which may be undefined). */
export interface ModelLike {
	id?: string;
	provider?: string;
}

function matches(spec: MatchSpec, model: ModelLike): boolean {
	// Each present field is ANDed. An empty match {} matches everything
	// (catch-all, use with care — documented in README).
	if (spec.provider !== undefined && spec.provider !== model.provider) {
		return false;
	}

	if (spec.modelId !== undefined && spec.modelId !== model.id) {
		return false;
	}

	if (spec.modelIdRegex !== undefined) {
		if (model.id === undefined) {
			return false;
		}
		try {
			if (!new RegExp(spec.modelIdRegex).test(model.id)) {
				return false;
			}
		} catch (error) {
			// Invalid regex: skip this rule, never throw.
			logDebug(`invalid modelIdRegex, skipping rule: ${spec.modelIdRegex}`, error);
			return false;
		}
	}

	return true;
}

/**
 * Walk the ordered rule list and return the template name of the first rule
 * whose match satisfies the model. Returns null when the model is absent or no
 * rule matches (→ transparent passthrough).
 */
export function resolveTemplateName(rules: Rule[], model: ModelLike | undefined): string | null {
	if (!model) {
		return null;
	}

	for (const rule of rules) {
		if (matches(rule.match, model)) {
			return rule.template;
		}
	}

	return null;
}
