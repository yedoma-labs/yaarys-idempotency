import { IdempotencyError } from "./errors.js";
import { assertValidKey, redactKey } from "./key.js";
import { validateStoredResponse } from "./response.js";
import type {
	CreateIdempotencyOptions,
	ExecuteOptions,
	ExecuteResult,
	Idempotency,
	IdempotencyRecord,
	IdempotencyStore,
} from "./types.js";

const DEFAULT_TTL_SECONDS = 86_400;
const DEFAULT_LOCK_TTL_SECONDS = 30;

function assertPositiveSeconds(name: string, value: number): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive finite number of seconds`);
	}
}

/**
 * Creates an idempotency executor on top of a store.
 *
 * Semantics for a key:
 * - no record: lock, run handler, store response, unlock -> `executed`
 * - completed record, same fingerprint: `replayed` with the stored response
 * - any record with a different fingerprint: KEY_REUSED_WITH_DIFFERENT_PAYLOAD
 * - in-flight lock with the same fingerprint: REQUEST_IN_PROGRESS
 * - handler throws: lock is released, nothing is cached, the error is rethrown
 */
export function createIdempotency(options: CreateIdempotencyOptions): Idempotency {
	const store: IdempotencyStore = options.store;
	const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
	const lockTtlSeconds = options.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
	const now = options.now ?? (() => Date.now());

	assertPositiveSeconds("ttlSeconds", ttlSeconds);
	assertPositiveSeconds("lockTtlSeconds", lockTtlSeconds);

	async function findLive(key: string): Promise<IdempotencyRecord | undefined> {
		const record = await store.get(key);
		if (record === undefined || record.expiresAt <= now()) {
			return undefined;
		}
		return record;
	}

	function resolveExisting(
		key: string,
		record: IdempotencyRecord,
		fingerprint: string,
	): ExecuteResult {
		if (record.fingerprint !== fingerprint) {
			throw new IdempotencyError(
				"KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
				`Idempotency key ${redactKey(key)} was already used with a different request`,
			);
		}
		if (record.state === "done" && record.response !== undefined) {
			return { status: "replayed", response: record.response };
		}
		throw new IdempotencyError(
			"REQUEST_IN_PROGRESS",
			`A request with idempotency key ${redactKey(key)} is already in progress`,
		);
	}

	async function releaseQuietly(key: string): Promise<void> {
		try {
			await store.release(key);
		} catch {
			// The lock expires via lockTtlSeconds. The handler error is more important.
		}
	}

	return {
		async execute({ key, fingerprint, handler }: ExecuteOptions): Promise<ExecuteResult> {
			assertValidKey(key);
			if (typeof fingerprint !== "string" || fingerprint.length === 0) {
				throw new TypeError("Idempotency fingerprint must be a non-empty string");
			}

			const existing = await findLive(key);
			if (existing !== undefined) {
				return resolveExisting(key, existing, fingerprint);
			}

			const locked = await store.tryLock(key, fingerprint, lockTtlSeconds);
			if (!locked) {
				// Another request took the key between get and tryLock.
				const raced = await findLive(key);
				if (raced !== undefined) {
					return resolveExisting(key, raced, fingerprint);
				}
				throw new IdempotencyError(
					"REQUEST_IN_PROGRESS",
					`A request with idempotency key ${redactKey(key)} is already in progress`,
				);
			}

			let response: ExecuteResult["response"];
			try {
				response = validateStoredResponse(await handler());
			} catch (error) {
				await releaseQuietly(key);
				throw error;
			}

			// If complete() fails, the lock stays until lockTtlSeconds. Retries then get
			// REQUEST_IN_PROGRESS and run the handler again only after the lock expires.
			await store.complete(key, { fingerprint, response }, ttlSeconds);
			return { status: "executed", response };
		},
	};
}
