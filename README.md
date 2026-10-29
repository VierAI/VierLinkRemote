# VierLink Remote (working name)

AI generated code. Not released. Requires code + relay audit and owner approval before any deploy or publish.

Two Dalamud plugins and one Cloudflare Worker:

| Folder | What |
|---|---|
| `VierLinkRemote/` | Tester plugin. Installs disabled, big disclaimer, scope-versioned consent. One-click encrypted clipboard export, and live sessions via a signed single-use token. Outgoing connections only. Nothing stored on disk except the enable/consent flags. |
| `receiver/` | Headless receiver (Node module loaded by a host). Mints tokens, decrypts snapshots and exports. Replaces the retired in-game viewer plugin. See receiver/README.md. |
| `Shared/` | Pinned public keys, token format, crypto (X25519 + HKDF-SHA256 + AES-256-GCM, Ed25519 signatures), relay client. |
| `worker/` | Relay Worker + Durable Object. Routes ciphertext only. |

## Scope (v3)
Scope 3: an AI assistant run by the token owner requests each capture and processes the data; no human takes part in
the debug process. Each live-session capture is a one-shot request (with a request id echoed in the reply); the tester's
plugin answers only matching, validated requests. A newer scope version asks the tester to consent again.

Data covered: players drawn on the tester's screen within 50 yalms who are PlayerSync pairs, plus the token owner's character
(matched by a per-session keyed hash, no name in code). Per player: PlayerSync state/status/last apply/keyed data hash;
Penumbra collection, counts of modded/missing/empty files and modded game-item prefixes; Glamourer equipped item names;
Customize+ active yes/no. No chat, no file paths or contents, no unpaired players.

Names, collection names and modded items are per-session keyed hashes and random labels by default. One per-session
"Reveal" switch shows names and mods together. The token owner's own character is always shown in clear.

## Token
`vlr1.<base64url(json)>.<base64url(ed25519 sig)>` with `{v, scope, sid, url, k, exp, self}`; `k` is a throwaway
32-byte session secret that never reaches the relay. The relay only gets `HKDF(k, sid, "vlr1 tester-auth")`.

## Relay hostname
`Shared/Proto.cs` `Pinned.RelayHost` is a placeholder ending in `.invalid`; live sessions refuse to run until it is set.
