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
 * Returns the exact bytes of a body. Views (DataView, typed arrays) are read by their own
 * offset and length, not by the whole underlying buffer. Other types are rejected, because
 * hashing them as "no bytes" would let different requests share one fingerprint.
 */
function bodyBytes(body: FingerprintInput["body"]): Uint8Array {
	if (body === undefined || body === null) {
		return new Uint8Array(0);
	}
	if (typeof body === "string") {
		return encoder.encode(body);
	}
	if (ArrayBuffer.isView(body)) {
		return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	}
	if (body instanceof ArrayBuffer) {
		return new Uint8Array(body);
	}
	throw new TypeError("fingerprintRequest: body must be a string, Uint8Array or ArrayBuffer");
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

	const body = bodyBytes(input.body);
	const header = encoder.encode(
		`${JSON.stringify([input.method.toUpperCase(), input.path])}\n${body.byteLength}\n`,
	);

	const framed = new Uint8Array(header.byteLength + body.byteLength);
	framed.set(header, 0);
	framed.set(body, header.byteLength);

	const digest = await globalThis.crypto.subtle.digest("SHA-256", framed);
	return toHex(new Uint8Array(digest));
}
