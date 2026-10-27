export interface StoredResponse {
	status: number;
	headers?: Record<string, string>;
	body: string;
}

export interface IdempotencyRecord {
	fingerprint: string;
	state: "processing" | "done";
	response?: StoredResponse;
	expiresAt: number;
}

export interface CompletedRecord {
	fingerprint: string;
	response: StoredResponse;
}

/**
 * Persistence contract. All TTLs are in seconds. Stores decide expiry with their own clock.
 *
 * - `tryLock` must be atomic: it succeeds only if the key is free (no live record).
 * - `complete` stores the final response and turns the key into a `done` record.
 * - `release` removes a `processing` lock. It must not remove a `done` record.
 */
export interface IdempotencyStore {
	get(key: string): Promise<IdempotencyRecord | undefined>;
	tryLock(key: string, fingerprint: string, ttlSeconds: number): Promise<boolean>;
	complete(key: string, record: CompletedRecord, ttlSeconds: number): Promise<void>;
	release(key: string): Promise<void>;
}

export interface CreateIdempotencyOptions {
	store: IdempotencyStore;
	/** Lifetime of a completed response. Default: 86400 (24 hours). */
	ttlSeconds?: number;
	/** Lifetime of an in-flight lock, used if a process crashes mid-request. Default: 30. */
	lockTtlSeconds?: number;
	/** Clock in milliseconds. Default: `Date.now`. */
	now?: () => number;
}

export interface ExecuteOptions {
	key: string;
	fingerprint: string;
	handler: () => Promise<StoredResponse>;
}

export interface ExecuteResult {
	status: "executed" | "replayed";
	response: StoredResponse;
}

export interface Idempotency {
	execute(options: ExecuteOptions): Promise<ExecuteResult>;
}

export interface FingerprintInput {
	method: string;
	path: string;
	body?: string | Uint8Array;
}
