import { IdempotencyError } from "./errors.js";

export const MAX_KEY_LENGTH = 255;

const KEY_PATTERN = /^[\x21-\x7E]+$/;

export function isValidKey(key: unknown): key is string {
	return (
		typeof key === "string" &&
		key.length > 0 &&
		key.length <= MAX_KEY_LENGTH &&
		KEY_PATTERN.test(key)
	);
}

export function assertValidKey(key: unknown): asserts key is string {
	if (!isValidKey(key)) {
		throw new IdempotencyError(
			"INVALID_KEY",
			`Idempotency key must be 1-${MAX_KEY_LENGTH} printable ASCII characters without whitespace`,
		);
	}
}

/** Shortened key for error messages and logs. Never log a full key. */
export function redactKey(key: string): string {
	return key.length <= 8 ? "[redacted]" : `${key.slice(0, 6)}...`;
}
