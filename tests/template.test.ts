import { expect, test, describe } from "bun:test";
import { parseHeaderTemplate } from "../src/template.js";

describe("parseHeaderTemplate", () => {
	test("splits on first colon only, preserving colons in value", () => {
		const lines = parseHeaderTemplate("x-codex-turn-metadata: {\"a\":\"b\",\"url\":\"http://x:8090\"}");
		expect(lines).toEqual([
			{ key: "x-codex-turn-metadata", rawValue: '{"a":"b","url":"http://x:8090"}' },
		]);
	});

	test("trims key and value, preserves key casing and order", () => {
		const lines = parseHeaderTemplate("X-App:  cli \nAccept: application/json");
		expect(lines).toEqual([
			{ key: "X-App", rawValue: "cli" },
			{ key: "Accept", rawValue: "application/json" },
		]);
	});

	test("ignores blank lines and # comments", () => {
		const lines = parseHeaderTemplate("# comment\n\nx-app: cli\n   \n# another");
		expect(lines).toEqual([{ key: "x-app", rawValue: "cli" }]);
	});

	test("skips lines with no colon or a leading colon", () => {
		const lines = parseHeaderTemplate("novalue\n:leading\nok: yes");
		expect(lines).toEqual([{ key: "ok", rawValue: "yes" }]);
	});

	test("allows empty value", () => {
		const lines = parseHeaderTemplate("x-empty:");
		expect(lines).toEqual([{ key: "x-empty", rawValue: "" }]);
	});

	test("handles CRLF line endings", () => {
		const lines = parseHeaderTemplate("a: 1\r\nb: 2");
		expect(lines).toEqual([
			{ key: "a", rawValue: "1" },
			{ key: "b", rawValue: "2" },
		]);
	});
});
