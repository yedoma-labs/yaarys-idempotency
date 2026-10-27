# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

Pre-1.0 releases are supported on the latest minor version only.

## Security Model

`@yedoma-labs/yaarys-idempotency` decides whether an HTTP request has already been processed.
It is used on the server, in front of handlers that create payments, orders or other side effects.
The security model assumes:

- **Handlers and stores** are written by trusted developers.
- **Idempotency keys, bodies and headers** come from clients and are untrusted.
- **Stores** are trusted to be atomic (for example Redis `SET NX` or a unique constraint).

## Security Features

1. **Key validation**: keys must be 1 to 255 printable ASCII characters without whitespace.
   Invalid keys fail with `INVALID_KEY` before any store access.
2. **No key leakage**: error messages and logs contain only a shortened key prefix.
3. **Payload binding**: a key is bound to the request fingerprint. Reusing a key for a different
   method, path or body fails with `KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.
4. **Prototype safety**: records are stored in a `Map`, not in plain objects. Keys such as
   `__proto__` or `constructor` are ordinary keys. Response headers are copied with
   `Object.fromEntries`.
5. **No caching of failures**: a handler error releases the lock and stores nothing.
6. **Response validation**: a handler result must have an HTTP status from 100 to 599 and a string
   body, and headers must be strings. Invalid results are not cached.
7. **Zero runtime dependencies**: the package adds no third-party code at runtime.

## Known Limitations

1. **Single-process memory store**: `createMemoryStore()` does not coordinate instances. It gives no
   protection against duplicate requests across servers.
2. **Lock expiry**: if a handler runs longer than `lockTtlSeconds`, a second request can start while
   the first is still running. Choose a lock TTL above the slowest handler.
3. **Completion failures**: if the store fails after the handler succeeded, the handler can run
   again once the lock expires. Use transactions or idempotent provider calls for side effects.
4. **Key scoping**: keys are global within a store. Scope keys per tenant or user in your code
   when clients may pick overlapping values.
5. **Timing**: fingerprints are compared with `!==`. The fingerprint is not a secret, so this is
   not a timing risk.

## Reporting Vulnerabilities

Please report security issues privately through GitHub Security Advisories on
https://github.com/yedoma-labs/yaarys-idempotency, or by opening an issue without exploit details if
no private channel is available.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will coordinate disclosure.

## Dependency Security

Run `pnpm audit` regularly. The library has no runtime dependencies.

## License

MIT - See [LICENSE](LICENSE) for details.
