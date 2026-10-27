# VierLink Remote receiver (headless creator side)

AI generated code.

A Node module (no dependencies, Node 22+ for the built-in `WebSocket` and `fetch`) that replaces the in-game
viewer. A host process loads it; it is not a service, daemon or scheduled job, and installs nothing.

## Use from a host

```js
import { createModule } from "<repo>/receiver/src/index.js";
const vlr = createModule({ config, getSecret, log });
await vlr.start();          // loads keys + webhook from the vault, wipes snapshotDir
const { session, token, expiresAt } = await vlr.startSession();
vlr.refresh(session);       // ask the tester for a fresh snapshot
vlr.end(session);           // End: closes the session and deletes its snapshot files now
vlr.decryptExport(text);    // vlrx1 export -> { at, warning, summary, snapshot } (untrusted)
vlr.status();
await vlr.stop();           // ends sessions, wipes keys from memory and the snapshot folder
```

- `getSecret(item, field)`: async, returns the field's value. Supplied by the host (the Mac's existing vault helper).
  Alternative: `config.secretCommand`, an argv array for an existing helper, with `{item}` and `{field}` placeholders,
  run without a shell; stdout is the value. Secret values are never logged or included in errors.
- `log(level, message)`: optional. Messages never contain keys, tokens, webhook URL or bearer, or snapshot content.

## Config keys

| Key | Default | Meaning |
|---|---|---|
| `snapshotDir` | (required) | Dedicated folder, created 0700. Files are 0600 `<session>-<seq>.json`. Wiped at start and stop. |
| `retentionHours` | 24 | Snapshot files are deleted this long after their session ends (tester left, relay closed, expiry). An explicit End deletes them at once. Capped at 500. A periodic sweep (by file age) also removes leftovers; start() always wipes the folder, so the host should call start() at launch. |
| `maxSessions` | 2 | Concurrent live sessions. |
| `http.enabled` | false | Optional local HTTP interface. Off: the host calls the module functions directly. |
| `http.port` | 17361 | Bound to 127.0.0.1 only. 17346 is refused. |
| `http.tokenFile` | unset | If set, the per-start bearer token is written there (0600) and deleted on stop. |
| `keysItem` / `keysField` | `VierLink Remote keys` / `password` | Vault item holding `vlrk1.<x25519>.<ed25519>`; must match the pinned public keys. |
| `webhookEnabled` | true | Post each snapshot to XIV Crash Bot. |
| `webhookItem` | `XIV Crash Bot webhook` | Vault item for the webhook. |
| `webhookUrlField` / `webhookKeyField` | `uri` / `password` | Fields holding the https URL and the bearer key. |
| `secretCommand` | unset | See above; only used when the host passes no `getSecret`. |
| `selfName` | "" | Optional `name@world` of the token owner, so the tester marks that character. Kept out of logs and files. |

No URL, key or identifier belongs in config files or git; the webhook URL and bearer come only from the vault.

## Local HTTP (off by default)

When enabled: 127.0.0.1 only; requests with an `Origin` header or another `Host` are refused, and every request needs
`Authorization: Bearer <token>`. The token is random, new at every start, compared in constant time, and available
to the host as `vlr.httpToken()` (and in `http.tokenFile` if set).

| Method | Path | Result |
|---|---|---|
| POST | `/start-session` | `{session, token, expiresAt}` |
| POST | `/sessions/<id>/refresh` | `{ok}` |
| POST | `/sessions/<id>/end` | `{ok}` (End: files deleted) |
| POST | `/export` | body `{"text":"vlrx1..."}` -> decrypted export |
| GET | `/sessions` | status |

`src/cli.js` is a thin client for these routes: `node receiver/src/cli.js --token-file <file> start-session`.

## Webhook

Each snapshot is sent once: `POST <url>` with `Authorization: Bearer <key>` and JSON `{session, path, summary}`.
`path` is the file name relative to `snapshotDir` (never an absolute path). Redirects are refused.
`summary` holds counts and fixed values only (mode, reveal, players, paired, ownerVisible, states, trimmed, error).
A 2xx response is final. Network errors, 5xx, 408 and 429 are retried twice (10 s, then 20 s later), then dropped;
other 4xx responses are not retried.

## Notes

- Tokens: same format, protocol 1, scope 2, 1 h expiry, pinned relay and fingerprint `3fc91495a6dfaa226937138c7cc2a4e0`.
- Reveal is the tester's switch in the plugin (their consent). The receiver reports it (`summary.reveal`) but cannot turn it on.
- Snapshot files are untrusted data from another player's client and are labelled as such.
- Tests: `cd receiver && node --test` (throwaway keys, fake relay, no network).

## Mac host config (Mac Script Master)

Requires Node 22 or newer (built-in `WebSocket` and `fetch`). `<HOME>` is the Mac user's home folder.

```json
{
  "snapshotDir": "<HOME>/<master>/state/vierlink-remote",
  "secretCommand": ["<HOME>/<vault-helper>/get-secret", "{item}", "{field}"],
  "retentionHours": 24,
  "http": { "enabled": false, "port": 17361 }
}
```

If the HTTP interface is ever enabled, keep port 17361 and read the bearer from `vlr.httpToken()`.
