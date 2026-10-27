import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/index.js";
import { runStoreContract } from "./helpers/store-contract.js";

runStoreContract("memory store", (now) => createMemoryStore({ now }));

describe("createMemoryStore", () => {
	it("returns copies, so callers cannot mutate stored responses", async () => {
		const store = createMemoryStore();
		await store.tryLock("k1", "fp", 30);
		await store.complete(
			"k1",
			{ fingerprint: "fp", response: { status: 200, headers: { a: "1" }, body: "ok" } },
			60,
		);
		const first = await store.get("k1");
		if (first?.response?.headers !== undefined) {
			first.response.headers.a = "changed";
		}
		first!.response!.body = "changed";
		const second = await store.get("k1");
		expect(second?.response).toEqual({ status: 200, headers: { a: "1" }, body: "ok" });
	});
});
