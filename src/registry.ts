import { logDebug } from "./logger.js";
import type { MatchSpec, Rule } from "./types.js";

/** Minimal shape we read off ctx.model (which may be undefined). */
export interface ModelLike {
	id?: string;
	provider?: string;
}

function matches(spec: MatchSpec, model: ModelLike): boolean {
	// Each present field is ANDed. An empty match {} matches everything.
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

type RuleScope = "model" | "provider" | "global";

function getRuleScope(spec: MatchSpec): RuleScope {
	if (spec.modelId !== undefined || spec.modelIdRegex !== undefined) {
		return "model";
	}
	if (spec.provider !== undefined) {
		return "provider";
	}
	return "global";
}

/**
 * Resolve exactly one template using fixed scope priority:
 * model > provider > global catch-all. Rule order matters only within a scope,
 * so a model match always excludes a matching provider template.
 */
export function resolveTemplateName(rules: Rule[], model: ModelLike | undefined): string | null {
	if (!model) {
		return null;
	}

	for (const scope of ["model", "provider", "global"] satisfies RuleScope[]) {
		for (const rule of rules) {
			if (getRuleScope(rule.match) === scope && matches(rule.match, model)) {
				return rule.template;
			}
		}
	}

	return null;
}
