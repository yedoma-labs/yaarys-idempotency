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

	it("rejects a method that is not an HTTP token", async () => {
		await expect(fingerprintRequest({ method: "PO ST", path: "/a" })).rejects.toThrow(TypeError);
	});
});
