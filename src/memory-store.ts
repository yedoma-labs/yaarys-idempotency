import { cloneResponse } from "./response.js";
import type { IdempotencyRecord, IdempotencyStore, StoredResponse } from "./types.js";

export interface MemoryStoreOptions {
	/** Clock in milliseconds. Default: `Date.now`. */
	now?: () => number;
}

interface Entry {
	fingerprint: string;
	state: "processing" | "done";
	response?: StoredResponse;
	expiresAt: number;
}

/**
 * In-memory store for tests and single-process use.
 *
 * WARNING: state lives in this process only. It is not shared between instances, restarts or
 * workers, so it does not protect against duplicates across multiple servers.
 *
 * Atomicity: every operation runs synchronously up to its return, so no other call can
 * interleave with `tryLock`. This holds only within one JavaScript event loop.
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): IdempotencyStore {
	const now = options.now ?? (() => Date.now());
	const entries = new Map<string, Entry>();

	function live(key: string): Entry | undefined {
		const entry = entries.get(key);
		if (entry === undefined) {
			return undefined;
		}
		if (entry.expiresAt <= now()) {
			entries.delete(key);
			return undefined;
		}
		return entry;
	}

	return {
		async get(key: string): Promise<IdempotencyRecord | undefined> {
			const entry = live(key);
			if (entry === undefined) {
				return undefined;
			}
			return {
				fingerprint: entry.fingerprint,
				state: entry.state,
				response: entry.response === undefined ? undefined : cloneResponse(entry.response),
				expiresAt: entry.expiresAt,
			};
		},

		async tryLock(key: string, fingerprint: string, ttlSeconds: number): Promise<boolean> {
			if (live(key) !== undefined) {
				return false;
			}
			entries.set(key, {
				fingerprint,
				state: "processing",
				expiresAt: now() + ttlSeconds * 1000,
			});
			return true;
		},

		async complete(
			key: string,
			record: { fingerprint: string; response: StoredResponse },
			ttlSeconds: number,
		): Promise<void> {
			entries.set(key, {
				fingerprint: record.fingerprint,
				state: "done",
				response: cloneResponse(record.response),
				expiresAt: now() + ttlSeconds * 1000,
			});
		},

		async release(key: string): Promise<void> {
			if (entries.get(key)?.state === "processing") {
				entries.delete(key);
			}
		},
	};
}
