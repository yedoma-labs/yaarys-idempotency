import { describe, expect, it } from "vitest";
import { fingerprintRequest } from "../src/index.js";

describe("fingerprintRequest", () => {
	it("is stable for identical input and returns a SHA-256 hex digest", async () => {
		const input = { method: "POST", path: "/orders", body: '{"amount":10}' };
		const first = await fingerprintRequest(input);
		const second = await fingerprintRequest({ ...input });
		expect(first).toBe(second);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
	});

	it("changes when the body changes", async () => {
		const a = await fingerprintRequest({ method: "POST", path: "/orders", body: '{"amount":10}' });
		const b = await fingerprintRequest({ method: "POST", path: "/orders", body: '{"amount":11}' });
		expect(a).not.toBe(b);
	});

	it("changes when method or path changes", async () => {
		const base = await fingerprintRequest({ method: "POST", path: "/orders", body: "x" });
		expect(await fingerprintRequest({ method: "PUT", path: "/orders", body: "x" })).not.toBe(base);
		expect(await fingerprintRequest({ method: "POST", path: "/refunds", body: "x" })).not.toBe(
			base,
		);
	});

	it("normalises the method to upper case", async () => {
		const upper = await fingerprintRequest({ method: "POST", path: "/a", body: "" });
		const lower = await fingerprintRequest({ method: "post", path: "/a", body: "" });
		expect(lower).toBe(upper);
	});

	it("does not collide when path and body try to imitate each other", async () => {
		const injected = await fingerprintRequest({ method: "POST", path: "/a\n1\nb", body: "" });
		const split = await fingerprintRequest({ method: "POST", path: "/a", body: "b" });
		expect(injected).not.toBe(split);
	});

	it("hashes a Uint8Array body the same as the equivalent string", async () => {
		const text = await fingerprintRequest({ method: "POST", path: "/a", body: "héllo" });
		const bytes = await fingerprintRequest({
			method: "POST",
			path: "/a",
			body: new TextEncoder().encode("héllo"),
		});
		expect(bytes).toBe(text);
	});

	it("hashes an ArrayBuffer body by its content, not only its length", async () => {
		const encode = (text: string) => new TextEncoder().encode(text).buffer;
		const one = await fingerprintRequest({
			method: "POST",
			path: "/a",
			body: encode('{"amount":1}'),
		});
		const two = await fingerprintRequest({
			method: "POST",
			path: "/a",
			body: encode('{"amount":2}'),
		});
		expect(one).not.toBe(two);
		expect(one).toBe(
			await fingerprintRequest({ method: "POST", path: "/a", body: '{"amount":1}' }),
		);
	});

	it("reads a view body by its own offset and length", async () => {
		const bytes = new TextEncoder().encode('xx{"a":1}yy');
		const view = bytes.subarray(2, 9);
		const direct = await fingerprintRequest({ method: "POST", path: "/a", body: '{"a":1}' });
		expect(await fingerprintRequest({ method: "POST", path: "/a", body: view })).toBe(direct);
		const dataView = new DataView(bytes.buffer, 2, 7);
		expect(await fingerprintRequest({ method: "POST", path: "/a", body: dataView as never })).toBe(
			direct,
		);
	});

	it("rejects a body that is not a string or binary data", async () => {
		await expect(
			fingerprintRequest({ method: "POST", path: "/a", body: 5 as never }),
		).rejects.toThrow(TypeError);
	});

	it("rejects a method that is not an HTTP token", async () => {
		await expect(fingerprintRequest({ method: "PO ST", path: "/a" })).rejects.toThrow(TypeError);
	});
});
