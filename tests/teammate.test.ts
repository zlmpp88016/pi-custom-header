import { expect, test, describe } from "bun:test";
import { registerTeammateChildExtension, getExtensionEntryPath } from "../src/teammate.js";

const TEAMMATE_CHILD_EXTENSIONS_KEY = Symbol.for("pi-maestro-teammate.child-extensions");

describe("teammate child extension registration", () => {
	test("getExtensionEntryPath resolves entry file", () => {
		const entryPath = getExtensionEntryPath();
		expect(typeof entryPath).toBe("string");
		expect(entryPath.length).toBeGreaterThan(0);
		expect(entryPath.endsWith(".ts") || entryPath.endsWith(".js")).toBe(true);
	});

	test("registerTeammateChildExtension sets registry on globalThis", () => {
		const success = registerTeammateChildExtension("/custom/test/path/index.ts");
		expect(success).toBe(true);

		const globals = globalThis as typeof globalThis & Record<symbol, any>;
		const registry = globals[TEAMMATE_CHILD_EXTENSIONS_KEY];
		expect(registry).toBeDefined();
		expect(registry.registrations).toBeDefined();

		const registrations = [...registry.registrations.values()];
		const found = registrations.find((r: any) => r.path === "/custom/test/path/index.ts");
		expect(found).toBeDefined();
		expect(found.tools).toEqual([]);
	});
});
