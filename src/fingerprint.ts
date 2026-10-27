import type { FingerprintInput } from "./types.js";

const METHOD_PATTERN = /^[A-Za-z]+$/;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * Computes a SHA-256 fingerprint (hex) of an HTTP request.
 *
 * The method is upper-cased. Method and path are JSON-encoded and the body is length-prefixed,
 * so different requests cannot produce the same byte stream. Headers are not included.
 * Pass the path including the query string if it changes the result.
 */
export async function fingerprintRequest(input: FingerprintInput): Promise<string> {
	if (typeof input.method !== "string" || !METHOD_PATTERN.test(input.method)) {
		throw new TypeError("fingerprintRequest: method must be an HTTP method token");
	}
	if (typeof input.path !== "string") {
		throw new TypeError("fingerprintRequest: path must be a string");
	}

	const body =
		typeof input.body === "string" ? encoder.encode(input.body) : (input.body ?? new Uint8Array(0));
	const header = encoder.encode(
		`${JSON.stringify([input.method.toUpperCase(), input.path])}\n${body.byteLength}\n`,
	);

	const framed = new Uint8Array(header.byteLength + body.byteLength);
	framed.set(header, 0);
	framed.set(body, header.byteLength);

	const digest = await globalThis.crypto.subtle.digest("SHA-256", framed);
	return toHex(new Uint8Array(digest));
}
