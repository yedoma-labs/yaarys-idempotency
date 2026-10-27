export type IdempotencyErrorCode =
	| "INVALID_KEY"
	| "KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
	| "REQUEST_IN_PROGRESS";

export class IdempotencyError extends Error {
	readonly code: IdempotencyErrorCode;
	/** Suggested HTTP status: 400 for invalid keys, 409 for conflicts. */
	readonly httpStatus: 400 | 409;

	constructor(code: IdempotencyErrorCode, message: string) {
		super(message);
		this.name = "IdempotencyError";
		this.code = code;
		this.httpStatus = code === "INVALID_KEY" ? 400 : 409;
	}
}
