import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadTemplate } from "./config.js";
import { logDebug, redactSecrets, setDebugEnabled } from "./logger.js";
import { createRenderContext } from "./placeholders.js";
import { resolveTemplateName, type ModelLike } from "./registry.js";
import { renderValue } from "./render.js";

function deleteHeadersCaseInsensitive(headers: Record<string, string | null>, names: string[]): void {
	const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
	for (const existingKey of Object.keys(headers)) {
		if (normalizedNames.has(existingKey.toLowerCase())) {
			delete headers[existingKey];
		}
	}
}

/**
 * HTTP header names are case-insensitive, but `_` and `-` are distinct. For
 * the session ID header, accept both spellings and emit only `session-id`.
 */
function isSessionIdHeader(key: string): boolean {
	const normalizedKey = key.toLowerCase();
	return normalizedKey === "session-id" || normalizedKey === "session_id";
}

function setHeaderCaseInsensitive(headers: Record<string, string | null>, key: string, value: string): void {
	const sessionIdHeader = isSessionIdHeader(key);
	deleteHeadersCaseInsensitive(headers, sessionIdHeader ? ["session-id", "session_id"] : [key]);
	headers[sessionIdHeader ? "session-id" : key] = value;
}

/**
 * pi-custom-header
 *
 * Registers `before_provider_headers` and, for a request whose model matches a
 * configured rule, injects that template's headers into `event.headers` —
 * static lines verbatim, dynamic lines via `{{placeholder}}` generators. Runs
 * after pi's static header assembly and replaces matching header names
 * case-insensitively, so it can reliably override models.json values.
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
			const rc = createRenderContext(ctx, config.sandbox);

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

				// `setHeaderCaseInsensitive` also normalizes the two session-id
				// spellings to the canonical hyphenated name.
				setHeaderCaseInsensitive(event.headers, key, value);
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
