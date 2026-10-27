import { describe, expect, it } from "vitest";
import type { IdempotencyStore, StoredResponse } from "../../src/index.js";

/**
 * Factory for a store under test. The store MUST use the given clock (milliseconds) for expiry.
 */
export type StoreFactory = (now: () => number) => IdempotencyStore | Promise<IdempotencyStore>;

const RESPONSE: StoredResponse = {
	status: 201,
	headers: { "content-type": "application/json" },
	body: '{"id":1}',
};

/** Runs the shared behaviour suite that every IdempotencyStore implementation must pass. */
export function runStoreContract(name: string, factory: StoreFactory): void {
	describe(`store contract: ${name}`, () => {
		async function setup(): Promise<{
			store: IdempotencyStore;
			advance: (ms: number) => void;
		}> {
			let current = 1_700_000_000_000;
			const store = await factory(() => current);
			return {
				store,
				advance: (ms: number) => {
					current += ms;
				},
			};
		}

		it("returns undefined for an unknown key", async () => {
			const { store } = await setup();
			expect(await store.get("unknown")).toBeUndefined();
		});

		it("grants a free key and refuses a held key", async () => {
			const { store } = await setup();
			expect(await store.tryLock("k1", "fp", 30)).toBe(true);
			expect(await store.tryLock("k1", "fp", 30)).toBe(false);
		});

		it("refuses tryLock when a completed record exists", async () => {
			const { store } = await setup();
			await store.tryLock("k1", "fp", 30);
			await store.complete("k1", { fingerprint: "fp", response: RESPONSE }, 86_400);
			expect(await store.tryLock("k1", "fp", 30)).toBe(false);
		});

		it("is atomic: concurrent tryLock calls grant exactly one lock", async () => {
			const { store } = await setup();
			const results = await Promise.all(
				Array.from({ length: 20 }, () => store.tryLock("race", "fp", 30)),
			);
			expect(results.filter(Boolean)).toHaveLength(1);
		});

		it("stores a completed record with fingerprint, state and response", async () => {
			const { store } = await setup();
			await store.tryLock("k1", "fp-1", 30);
			await store.complete("k1", { fingerprint: "fp-1", response: RESPONSE }, 86_400);
			const record = await store.get("k1");
			expect(record?.state).toBe("done");
			expect(record?.fingerprint).toBe("fp-1");
			expect(record?.response).toEqual(RESPONSE);
		});

		it("release frees a processing lock", async () => {
			const { store } = await setup();
			await store.tryLock("k1", "fp", 30);
			await store.release("k1");
			expect(await store.get("k1")).toBeUndefined();
			expect(await store.tryLock("k1", "fp", 30)).toBe(true);
		});

		it("release does not remove a completed record", async () => {
			const { store } = await setup();
			await store.tryLock("k1", "fp", 30);
			await store.complete("k1", { fingerprint: "fp", response: RESPONSE }, 86_400);
			await store.release("k1");
			expect((await store.get("k1"))?.state).toBe("done");
		});

		it("expires a processing lock after its TTL", async () => {
			const { store, advance } = await setup();
			await store.tryLock("k1", "fp", 10);
			advance(9_999);
			expect(await store.tryLock("k1", "fp", 10)).toBe(false);
			advance(1);
			expect(await store.tryLock("k1", "fp", 10)).toBe(true);
		});

		it("expires a completed record after its TTL", async () => {
			const { store, advance } = await setup();
			await store.tryLock("k1", "fp", 30);
			await store.complete("k1", { fingerprint: "fp", response: RESPONSE }, 60);
			advance(59_999);
			expect(await store.get("k1")).toBeDefined();
			advance(1);
			expect(await store.get("k1")).toBeUndefined();
		});

		it("isolates keys, including prototype-named keys", async () => {
			const { store } = await setup();
			expect(await store.tryLock("__proto__", "fp", 30)).toBe(true);
			expect(await store.get("constructor")).toBeUndefined();
			expect(await store.get("toString")).toBeUndefined();
			expect(await store.tryLock("constructor", "fp", 30)).toBe(true);
		});
	});
}
