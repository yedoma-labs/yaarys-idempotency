import { describe, expect, it } from "vitest";
import {
	createIdempotency,
	createMemoryStore,
	IdempotencyError,
	type StoredResponse,
} from "../src/index.js";

const RESPONSE: StoredResponse = {
	status: 201,
	headers: { "content-type": "application/json" },
	body: '{"orderId":"o-1"}',
};

function setup(options: { ttlSeconds?: number; lockTtlSeconds?: number } = {}) {
	let current = 1_700_000_000_000;
	const now = () => current;
	const store = createMemoryStore({ now });
	const idempotency = createIdempotency({ store, now, ...options });
	return {
		idempotency,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function expectIdempotencyError(
	promise: Promise<unknown>,
	code: IdempotencyError["code"],
): Promise<IdempotencyError> {
	const error = await promise.then(
		() => {
			throw new Error("expected rejection");
		},
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(IdempotencyError);
	expect((error as IdempotencyError).code).toBe(code);
	return error as IdempotencyError;
}

describe("createIdempotency", () => {
	it("executes the handler on first call and returns its response", async () => {
		const { idempotency } = setup();
		const handler = async () => RESPONSE;
		const result = await idempotency.execute({ key: "k-1", fingerprint: "fp", handler });
		expect(result).toEqual({ status: "executed", response: RESPONSE });
	});

	it("replays the stored response without calling the handler again", async () => {
		const { idempotency } = setup();
		let calls = 0;
		const handler = async () => {
			calls++;
			return RESPONSE;
		};
		await idempotency.execute({ key: "k-1", fingerprint: "fp", handler });
		const replay = await idempotency.execute({ key: "k-1", fingerprint: "fp", handler });
		expect(calls).toBe(1);
		expect(replay).toEqual({ status: "replayed", response: RESPONSE });
	});

	it("rejects a reused key with a different fingerprint and never runs the handler", async () => {
		const { idempotency } = setup();
		let calls = 0;
		const handler = async () => {
			calls++;
			return RESPONSE;
		};
		await idempotency.execute({ key: "k-1", fingerprint: "fp-a", handler });
		const error = await expectIdempotencyError(
			idempotency.execute({ key: "k-1", fingerprint: "fp-b", handler }),
			"KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
		);
		expect(error.httpStatus).toBe(409);
		expect(calls).toBe(1);
	});

	it("rejects a parallel request with the same key while the lock is held", async () => {
		const { idempotency } = setup();
		const gate = deferred<StoredResponse>();
		const first = idempotency.execute({
			key: "k-1",
			fingerprint: "fp",
			handler: () => gate.promise,
		});
		const second = idempotency.execute({
			key: "k-1",
			fingerprint: "fp",
			handler: async () => RESPONSE,
		});
		const error = await expectIdempotencyError(second, "REQUEST_IN_PROGRESS");
		expect(error.httpStatus).toBe(409);
		gate.resolve(RESPONSE);
		expect(await first).toEqual({ status: "executed", response: RESPONSE });
	});

	it("runs the handler exactly once for two concurrent identical requests", async () => {
		const { idempotency } = setup();
		let calls = 0;
		const handler = async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return RESPONSE;
		};
		const results = await Promise.allSettled([
			idempotency.execute({ key: "k-race", fingerprint: "fp", handler }),
			idempotency.execute({ key: "k-race", fingerprint: "fp", handler }),
		]);
		expect(calls).toBe(1);
		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		const reason = (rejected[0] as PromiseRejectedResult).reason as IdempotencyError;
		expect(reason.code).toBe("REQUEST_IN_PROGRESS");
	});

	it("rethrows handler errors, releases the lock and does not cache the failure", async () => {
		const { idempotency } = setup();
		const boom = new Error("payment provider down");
		await expect(
			idempotency.execute({
				key: "k-1",
				fingerprint: "fp",
				handler: async () => {
					throw boom;
				},
			}),
		).rejects.toBe(boom);

		let calls = 0;
		const retry = await idempotency.execute({
			key: "k-1",
			fingerprint: "fp",
			handler: async () => {
				calls++;
				return RESPONSE;
			},
		});
		expect(calls).toBe(1);
		expect(retry).toEqual({ status: "executed", response: RESPONSE });
	});

	it("frees an in-flight lock after lockTtlSeconds when the process did not finish", async () => {
		const { idempotency, advance } = setup({ lockTtlSeconds: 30 });
		// Simulates a crashed worker: the handler never settles and the lock stays.
		void idempotency.execute({
			key: "k-crash",
			fingerprint: "fp",
			handler: () => new Promise<StoredResponse>(() => {}),
		});
		await Promise.resolve();
		await expectIdempotencyError(
			idempotency.execute({ key: "k-crash", fingerprint: "fp", handler: async () => RESPONSE }),
			"REQUEST_IN_PROGRESS",
		);

		advance(29_999);
		await expectIdempotencyError(
			idempotency.execute({ key: "k-crash", fingerprint: "fp", handler: async () => RESPONSE }),
			"REQUEST_IN_PROGRESS",
		);

		advance(1);
		const result = await idempotency.execute({
			key: "k-crash",
			fingerprint: "fp",
			handler: async () => RESPONSE,
		});
		expect(result.status).toBe("executed");
	});

	it("executes again after the completed record expired", async () => {
		const { idempotency, advance } = setup({ ttlSeconds: 60 });
		let calls = 0;
		const handler = async () => {
			calls++;
			return RESPONSE;
		};
		await idempotency.execute({ key: "k-1", fingerprint: "fp", handler });
		advance(59_999);
		expect((await idempotency.execute({ key: "k-1", fingerprint: "fp", handler })).status).toBe(
			"replayed",
		);
		advance(1);
		expect((await idempotency.execute({ key: "k-1", fingerprint: "fp", handler })).status).toBe(
			"executed",
		);
		expect(calls).toBe(2);
	});

	it("accepts valid keys at the boundaries", async () => {
		const { idempotency } = setup();
		for (const key of ["a", "x".repeat(255), "3f2b8c1e-9d4a-4b7e-8f1a-0c2d3e4f5a6b", "a_b.c:d~e"]) {
			const result = await idempotency.execute({
				key,
				fingerprint: "fp",
				handler: async () => RESPONSE,
			});
			expect(result.status).toBe("executed");
		}
	});

	it.each([
		["empty", ""],
		["too long", "x".repeat(256)],
		["space", "has space"],
		["newline", "a\nb"],
		["control char", "a\u0007b"],
		["non-ascii", "schlüssel"],
		["undefined", undefined],
		["number", 42],
	])("rejects an invalid key (%s) with INVALID_KEY and does not leak it", async (_, key) => {
		const { idempotency } = setup();
		const error = await expectIdempotencyError(
			idempotency.execute({
				key: key as unknown as string,
				fingerprint: "fp",
				handler: async () => RESPONSE,
			}),
			"INVALID_KEY",
		);
		expect(error.httpStatus).toBe(400);
		if (typeof key === "string" && key.length > 0) {
			expect(error.message).not.toContain(key);
		}
	});

	it("does not echo the full key in error messages for conflicts", async () => {
		const { idempotency } = setup();
		const secretKey = "secret-key-value-1234567890";
		await idempotency.execute({
			key: secretKey,
			fingerprint: "fp-a",
			handler: async () => RESPONSE,
		});
		const error = await expectIdempotencyError(
			idempotency.execute({ key: secretKey, fingerprint: "fp-b", handler: async () => RESPONSE }),
			"KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
		);
		expect(error.message).not.toContain(secretKey);
	});

	it("rejects a handler result that cannot be cached", async () => {
		const { idempotency } = setup();
		await expect(
			idempotency.execute({
				key: "k-1",
				fingerprint: "fp",
				handler: async () => ({ status: 42, body: "" }),
			}),
		).rejects.toThrow(TypeError);
		const retry = await idempotency.execute({
			key: "k-1",
			fingerprint: "fp",
			handler: async () => RESPONSE,
		});
		expect(retry.status).toBe("executed");
	});

	it("rejects non-positive TTL options", () => {
		const store = createMemoryStore();
		expect(() => createIdempotency({ store, ttlSeconds: 0 })).toThrow(RangeError);
		expect(() => createIdempotency({ store, lockTtlSeconds: -1 })).toThrow(RangeError);
		expect(() => createIdempotency({ store, lockTtlSeconds: Number.NaN })).toThrow(RangeError);
	});
});
