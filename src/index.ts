import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadTemplate } from "./config.js";
import { logDebug } from "./logger.js";
import { createRenderContext } from "./placeholders.js";
import { resolveTemplateName, type ModelLike } from "./registry.js";
import { renderValue } from "./render.js";

/**
 * pi-custom-header
 *
 * Registers `before_provider_headers` and, for a request whose model matches a
 * configured rule, injects that template's headers into `event.headers` —
 * static lines verbatim, dynamic lines via `{{placeholder}}` generators. Runs
 * after pi's static header assembly, so it can override models.json values.
 *
 * Every failure path degrades to transparent passthrough (headers untouched);
 * it must never throw and block a provider request.
 */
export default function piCustomHeader(pi: ExtensionAPI): void {
	pi.on("before_provider_headers", (event, ctx: ExtensionContext) => {
		try {
			const config = loadConfig();
			if (config.rules.length === 0) {
				return; // Nothing configured → transparent passthrough.
			}

			const model = ctx.model as ModelLike | undefined;
			const templateName = resolveTemplateName(config.rules, model);
			if (templateName === null) {
				return; // Model absent or no rule matched → passthrough.
			}

			const template = loadTemplate(templateName);
			if (template === null) {
				return; // Template unreadable → passthrough (do not partially apply).
			}

			const blacklist = new Set(config.blacklist.map((h) => h.toLowerCase()));
			const rc = createRenderContext(ctx, config.sandbox);

			for (const { key, rawValue } of template.lines) {
				// Skip auth/transport headers managed by pi or the HTTP layer.
				if (blacklist.has(key.toLowerCase())) {
					continue;
				}

				const { value, unknown } = renderValue(rawValue, rc, config.unknownPlaceholder);
				if (unknown.length > 0) {
					logDebug(`unknown placeholder(s) in ${templateName} "${key}": ${unknown.join(", ")}`);
				}
				if (value === undefined) {
					continue; // drop-line policy for an unknown placeholder.
				}

				event.headers[key] = value;
			}
		} catch (error) {
			// Absolute red line: never block a request.
			logDebug("before_provider_headers handler failed; passing through", error);
		}
	});
}
