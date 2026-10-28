# @yedoma-labs/yaarys-idempotency

<picture>
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/yedoma-labs/assets/main/resized/banner-resized-mobile.png">
  <img src="https://raw.githubusercontent.com/yedoma-labs/assets/main/resized/banner-resized.png" alt="Project Header">
</picture>

[![CI](https://github.com/yedoma-labs/yaarys-idempotency/actions/workflows/ci.yml/badge.svg)](https://github.com/yedoma-labs/yaarys-idempotency/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@yedoma-labs/yaarys-idempotency.svg)](https://www.npmjs.com/package/@yedoma-labs/yaarys-idempotency)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Framework-agnostic idempotency keys for `POST` requests with pluggable stores, in-flight locking
and clear errors.

A client retry (timeout, double click, network drop) must not create a second payment or order.

## The problem

Clients retry POST requests when they do not get a response. Without protection, each retry runs
the handler again: the customer is charged twice or receives two orders. The usual fix is an
`Idempotency-Key` header. The same key returns the stored response instead of running the handler
again. This library implements that logic without depending on a web framework or a database.

What it guarantees for one key:

- **First request** runs the handler and stores the response.
- **Retry with the same key and the same request** returns the stored response. The handler does
  not run again.
- **Same key, different request** is rejected (`KEY_REUSED_WITH_DIFFERENT_PAYLOAD`).
- **Parallel request with the same key** while the first is still running is rejected
  (`REQUEST_IN_PROGRESS`). The handler never runs twice at the same time.
- **Handler throws** releases the lock and caches nothing, so the client can retry.
- **Crashed process** leaves a lock that expires after `lockTtlSeconds`.

## Installation

```sh
pnpm add @yedoma-labs/yaarys-idempotency
```

Requires Node.js 20 or newer. The package has no runtime dependencies.

## Quickstart

```ts
import {
	createIdempotency,
	createMemoryStore,
	fingerprintRequest,
	IdempotencyError,
} from "@yedoma-labs/yaarys-idempotency";

const idempotency = createIdempotency({
	store: createMemoryStore(), // single process only, see "Stores" below
	ttlSeconds: 86_400, // how long a completed response is replayed (default: 24 h)
	lockTtlSeconds: 30, // how long an in-flight lock lives if a process crashes (default: 30 s)
});

const body = '{"amount":1000,"currency":"EUR"}';

const result = await idempotency.execute({
	key: "3f2b8c1e-9d4a-4b7e-8f1a-0c2d3e4f5a6b", // from the client's Idempotency-Key header
	fingerprint: await fingerprintRequest({ method: "POST", path: "/payments", body }),
	handler: async () => {
		const payment = await chargeCustomer(JSON.parse(body));
		return {
			status: 201,
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payment),
		};
	},
});

// result.status: "executed" | "replayed"
// result.response: { status, headers?, body } to send to the client
```

Errors are instances of `IdempotencyError` with a `code` and a suggested `httpStatus`:

| `code`                              | `httpStatus` | Meaning                                        |
| ----------------------------------- | ------------ | ---------------------------------------------- |
| `INVALID_KEY`                       | 400          | Missing or malformed key                       |
| `KEY_REUSED_WITH_DIFFERENT_PAYLOAD` | 409          | Key was already used for a different request   |
| `REQUEST_IN_PROGRESS`               | 409          | Another request with this key is still running |

## Express example

The library does not ship middleware. Use the core directly:

```ts
import express from "express";
import {
	createIdempotency,
	createMemoryStore,
	fingerprintRequest,
	IdempotencyError,
} from "@yedoma-labs/yaarys-idempotency";

const idempotency = createIdempotency({ store: createMemoryStore() });

const app = express();
// Keep the raw body as a string so the fingerprint covers exactly what the client sent.
app.use(express.text({ type: "application/json" }));

app.post("/payments", async (req, res) => {
	const body = typeof req.body === "string" ? req.body : "";
	try {
		const result = await idempotency.execute({
			key: req.get("Idempotency-Key") ?? "",
			fingerprint: await fingerprintRequest({ method: req.method, path: req.originalUrl, body }),
			handler: async () => {
				const payment = await chargeCustomer(JSON.parse(body));
				return {
					status: 201,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payment),
				};
			},
		});
		res.set("Idempotent-Replayed", result.status === "replayed" ? "true" : "false");
		res.set(result.response.headers ?? {});
		res.status(result.response.status).send(result.response.body);
	} catch (error) {
		if (error instanceof IdempotencyError) {
			res.status(error.httpStatus).json({ error: error.code });
			return;
		}
		throw error;
	}
});
```

## Hono example

```ts
import { Hono } from "hono";
import {
	createIdempotency,
	createMemoryStore,
	fingerprintRequest,
	IdempotencyError,
} from "@yedoma-labs/yaarys-idempotency";

const idempotency = createIdempotency({ store: createMemoryStore() });

const app = new Hono();

app.post("/payments", async (c) => {
	const body = await c.req.text();
	try {
		const result = await idempotency.execute({
			key: c.req.header("Idempotency-Key") ?? "",
			fingerprint: await fingerprintRequest({ method: c.req.method, path: c.req.path, body }),
			handler: async () => {
				const payment = await chargeCustomer(JSON.parse(body));
				return {
					status: 201,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payment),
				};
			},
		});
		return new Response(result.response.body, {
			status: result.response.status,
			headers: {
				...result.response.headers,
				"Idempotent-Replayed": result.status === "replayed" ? "true" : "false",
			},
		});
	} catch (error) {
		if (error instanceof IdempotencyError) {
			return c.json({ error: error.code }, error.httpStatus);
		}
		throw error;
	}
});
```

Include the query string in `path` (Express: `req.originalUrl`, Hono: `new URL(c.req.url).pathname + new URL(c.req.url).search`) if it changes the operation.

## Keys

- Keys must be 1 to 255 printable ASCII characters without whitespace. Anything else throws
  `INVALID_KEY`.
- Keys are global within a store. Scope them to the caller if clients are not trusted to pick
  unique keys, for example by prefixing the user ID in your own code, and never log full keys.
- Use the same key only for the same operation. Reusing a key for a different request is an error
  by design.

## Request fingerprint

`fingerprintRequest({ method, path, body })` returns a SHA-256 hex digest of the method, path and
body. Headers are not included. The body can be a `string`, `Uint8Array`, `ArrayBuffer` or another
binary view, and is hashed by its bytes. Any other body type throws a `TypeError`.

## Store interface

A store persists records. Every TTL is in seconds. Expiry is decided by the store's own clock.

```ts
interface IdempotencyStore {
	// Returns the record for the key, or undefined if missing or expired.
	get(key: string): Promise<IdempotencyRecord | undefined>;
	// Atomically takes the key if it is free (no live record). Returns false otherwise.
	tryLock(key: string, fingerprint: string, ttlSeconds: number): Promise<boolean>;
	// Stores the final response and marks the key as "done".
	complete(
		key: string,
		record: { fingerprint: string; response: StoredResponse },
		ttlSeconds: number,
	): Promise<void>;
	// Removes a "processing" lock. Must not remove a "done" record.
	release(key: string): Promise<void>;
}

interface IdempotencyRecord {
	fingerprint: string;
	state: "processing" | "done";
	response?: StoredResponse;
	expiresAt: number; // epoch milliseconds
}

interface StoredResponse {
	status: number;
	headers?: Record<string, string>;
	body: string;
}
```

Custom stores must pass the shared contract suite (`tests/helpers/store-contract.ts` in this
repository, exported as `runStoreContract(name, factory)`). It checks atomic locking, completion,
release, and TTL expiry.

## Stores

### createMemoryStore (single process only)

`createMemoryStore()` keeps all state in process memory. It is meant for tests, development, and
single-process applications.

> **Warning:** The memory store does not work across multiple instances, workers, or restarts. Two
> servers each have their own memory, so a retry that reaches the other server runs the handler
> again. Use a shared store in production.

### Shared stores (Redis, SQL)

A production store must make `tryLock` atomic across all instances:

- **Redis:** `SET key fingerprint NX PX <lockTtlMs>` for `tryLock`. `complete` overwrites the key
  with the response and a longer TTL. `release` deletes the key only while it still holds a
  `processing` record.
- **SQL:** Insert the key with a unique constraint on the key column (or `INSERT ... ON CONFLICT
  DO NOTHING`). Run the handler's side effects and the `complete` update in the same transaction
  whenever the handler writes to the same database, so the response and the effect are committed
  together.

Expiry in shared stores must use the database or Redis clock, not the clock of each instance.

## Limitations

- The handler should be idempotent or transactional with `complete`. If `complete` fails after
  the handler succeeded, the lock stays until `lockTtlSeconds` passes and then the handler can run
  again. Charge providers should accept your own idempotency key as well.
- A lock that expires while the handler is still running can be taken by a second request. Keep
  `lockTtlSeconds` longer than the slowest expected handler.
- Responses are stored as strings. Streaming responses and binary bodies are not supported.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT. See [LICENSE](LICENSE).
