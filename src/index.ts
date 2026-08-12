import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadTemplate } from "./config.js";
import { logDebug, redactSecrets, setDebugEnabled } from "./logger.js";
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
			// Drive diagnostics from config; no-op unless the user set "debug": true.
			setDebugEnabled(config.debug);

			const model = ctx.model as ModelLike | undefined;
			const modelLabel = model ? `${model.provider ?? "?"}/${model.id ?? "?"}` : "(no model)";

			if (config.rules.length === 0) {
				logDebug(`no rules configured; passthrough for ${modelLabel}`);
				return;
			}

			const templateName = resolveTemplateName(config.rules, model);
			if (templateName === null) {
				logDebug(`no rule matched ${modelLabel}; passthrough`);
				return;
			}

			const template = loadTemplate(templateName);
			if (template === null) {
				logDebug(`template "${templateName}" unreadable for ${modelLabel}; passthrough`);
				return;
			}

			const blacklist = new Set(config.blacklist.map((h) => h.toLowerCase()));
			const rc = createRenderContext(ctx);

			logDebug(`${modelLabel} → template "${templateName}"`);

			let injected = 0;
			let skipped = 0;
			for (const { key, rawValue } of template.lines) {
				// Skip auth/transport headers managed by pi or the HTTP layer.
				if (blacklist.has(key.toLowerCase())) {
					skipped++;
					logDebug(`  skip (blacklist): ${key}`);
					continue;
				}

				const { value, unknown } = renderValue(rawValue, rc);
				if (unknown.length > 0) {
					logDebug(`  unknown placeholder(s) in "${key}": ${unknown.join(", ")}`);
				}
				if (value === undefined) {
					skipped++;
					continue; // drop-line policy for an unknown placeholder.
				}

				event.headers[key] = value;
				injected++;
				logDebug(`  set ${key}: ${redactSecrets(value)}`);
			}

			logDebug(`done ${modelLabel}: ${injected} set, ${skipped} skipped`);
		} catch (error) {
			// Absolute red line: never block a request.
			logDebug("before_provider_headers handler failed; passing through", error);
		}
	});
}
