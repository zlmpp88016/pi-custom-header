import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadTemplate } from "./config.js";
import { logDebug, redactSecrets, setDebugEnabled } from "./logger.js";
import { createRenderContext } from "./placeholders.js";
import { resolveTemplateName, type ModelLike } from "./registry.js";
import { renderValue } from "./render.js";
import { recordActiveMainSession } from "./session-cache.js";
import { registerTeammateChildExtension } from "./teammate.js";

function deleteHeadersCaseInsensitive(headers: Record<string, string | null>, names: string[]): void {
	const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
	for (const existingKey of Object.keys(headers)) {
		if (normalizedNames.has(existingKey.toLowerCase())) {
			delete headers[existingKey];
		}
	}
}

/**
 * Set a header, removing any existing case variants first.
 *
 * For session-id variants, canonicalize to hyphenated `session-id`. A template
 * that specifies `session_id: ...` or an existing header `Session_Id: ...` will
 * therefore produce a single `session-id: ...` header on the outgoing request.
 */
function setHeaderCaseInsensitive(headers: Record<string, string | null>, key: string, value: string): void {
	const lower = key.toLowerCase();
	if (lower === "session-id" || lower === "session_id") {
		deleteHeadersCaseInsensitive(headers, ["session-id", "session_id"]);
		headers["session-id"] = value;
		return;
	}

	deleteHeadersCaseInsensitive(headers, [key]);
	headers[key] = value;
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
 * Also registers with pi-maestro-teammate's child extension registry so that
 * child agent subprocesses (spawned with --no-extensions) will also load this
 * extension and apply custom headers.
 *
 * Every failure path degrades to transparent passthrough (headers untouched);
 * it must never throw and block a provider request.
 */
export default function piCustomHeader(pi: ExtensionAPI): void {
	try {
		const config = loadConfig();
		setDebugEnabled(config.debug);

		// If teammate propagation is enabled, register this extension into pi-maestro-teammate's
		// child extensions registry so that child agent processes (which run with --no-extensions)
		// will also load this extension via --extension <entryPath>.
		if (config.teammate) {
			registerTeammateChildExtension();
		}
	} catch (error) {
		logDebug("initialization error in piCustomHeader", error);
	}

	// Re-register on session_start to ensure child registration stays active across session restarts
	// and record the active main session ID.
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		try {
			const sid = ctx.sessionManager?.getSessionId?.();
			if (sid) {
				recordActiveMainSession(sid, ctx.cwd);
			}
			const config = loadConfig();
			if (config.teammate) {
				registerTeammateChildExtension();
			}
		} catch (error) {
			logDebug("session_start initialization failed", error);
		}
	});

	pi.on("before_agent_start", (_event, ctx: ExtensionContext) => {
		try {
			const sid = ctx.sessionManager?.getSessionId?.();
			if (sid) {
				recordActiveMainSession(sid, ctx.cwd);
			}
		} catch {
			// ignore
		}
	});

	pi.on("before_provider_headers", (event, ctx: ExtensionContext) => {
		try {
			const config = loadConfig();
			// Drive diagnostics from config; no-op unless the user set "debug": true.
			setDebugEnabled(config.debug);

			const isChild = process.env.PI_TEAMMATE_CHILD === "1";
			const childPrefix = isChild
				? `[teammate-child:${process.env.PI_TEAMMATE_CORRELATION_ID ?? "unknown"}] `
				: "";

			if (!isChild) {
				const sid = ctx.sessionManager?.getSessionId?.();
				if (sid) {
					recordActiveMainSession(sid, ctx.cwd);
				}
			}

			const model = ctx.model as ModelLike | undefined;
			const modelLabel = model ? `${model.provider ?? "?"}/${model.id ?? "?"}` : "(no model)";

			if (config.rules.length === 0) {
				logDebug(`${childPrefix}no rules configured; passthrough for ${modelLabel}`);
				return;
			}

			const templateName = resolveTemplateName(config.rules, model);
			if (templateName === null) {
				logDebug(`${childPrefix}no rule matched ${modelLabel}; passthrough`);
				return;
			}

			const template = loadTemplate(templateName);
			if (template === null) {
				logDebug(`${childPrefix}template "${templateName}" unreadable for ${modelLabel}; passthrough`);
				return;
			}

			const blacklist = new Set(config.blacklist.map((h) => h.toLowerCase()));
			const rc = createRenderContext(ctx, config.sandbox, config.inheritParentSession);

			logDebug(`${childPrefix}${modelLabel} → template "${templateName}"`);

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

			logDebug(`${childPrefix}done ${modelLabel}: ${injected} set, ${skipped} skipped`);
		} catch (error) {
			// Absolute red line: never block a request.
			logDebug("before_provider_headers handler failed; passing through", error);
		}
	});
}
