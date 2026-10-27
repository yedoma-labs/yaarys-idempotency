import type { StoredResponse } from "./types.js";

export function cloneResponse(response: StoredResponse): StoredResponse {
	const copy: StoredResponse = { status: response.status, body: response.body };
	if (response.headers !== undefined) {
		// Object.fromEntries defines own properties, so keys like "__proto__" stay plain data.
		copy.headers = Object.fromEntries(Object.entries(response.headers));
	}
	return copy;
}

/** Validates a handler result before it is cached. Returns a defensive copy. */
export function validateStoredResponse(value: StoredResponse): StoredResponse {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("Idempotency handler must resolve to a StoredResponse object");
	}
	if (!Number.isInteger(value.status) || value.status < 100 || value.status > 599) {
		throw new TypeError("Idempotency handler response status must be an integer from 100 to 599");
	}
	if (typeof value.body !== "string") {
		throw new TypeError("Idempotency handler response body must be a string");
	}
	if (value.headers !== undefined) {
		if (typeof value.headers !== "object" || value.headers === null) {
			throw new TypeError("Idempotency handler response headers must be a record of strings");
		}
		for (const headerValue of Object.values(value.headers)) {
			if (typeof headerValue !== "string") {
				throw new TypeError("Idempotency handler response headers must be strings");
			}
		}
	}
	return cloneResponse(value);
}
