# WebRTC, PeerJS, And TURN

PeerJS handles signaling. Browser WebRTC carries media and DataConnection payloads.

## ICE Configuration

`src/lib/iceConfig.ts` owns RTC configuration generation.

The base ICE list contains Cloudflare STUN and one Google STUN endpoint. Default TURN mode is `on`: when a complete TURN configuration is present, initial PeerJS RTC config includes STUN plus TURN candidates. This improves cross-network and cross-carrier success at the cost of possible TURN candidate allocation; offering a TURN candidate does not mean the selected path is relayed.

TURN mode can be overridden by URL query/hash or `VITE_TURN_MODE`:

- `turn=0`, `turn=false`, or `turn=off`: disable initial TURN candidates.
- `turn=1`, `turn=true`, or `turn=on`: include TURN candidates.
- `turn=force` or `turn=relay`: set relay-only ICE policy for diagnostics. If no TURN URL is configured, this intentionally produces relay-only config without usable relay servers, so the connection should fail instead of silently falling back to STUN.

URL values override `VITE_TURN_MODE`.

A TURN config is considered complete only when it has at least one TURN URL plus both username and credential. URL-only or partial-credential TURN config is ignored for the current coturn-style deployment.

## Credential Resolution

`src/hooks/usePeer.ts` resolves credentials before creating the PeerJS instance:

1. Request `GET /api/turn-credentials` or the `VITE_TURN_CREDENTIALS_URL` override with a 3-second timeout and `no-store` caching.
2. Accept only complete `turn:`/`turns:` URL arrays, non-empty username/credential values, and an expiration at least 60 seconds in the future.
3. Prefer a valid dynamic response. If it is unavailable, use complete static `VITE_TURN_*` values as a migration/local fallback.
4. Refresh dynamic credentials one minute before expiry. Failed refreshes retry after 30 seconds while dynamic credentials were active or no static fallback exists; a pure static fallback retries every five minutes.
5. Apply refreshed RTC configuration only to future PeerJS connections. Never interrupt an otherwise healthy current connection merely to rotate credentials.

`functions/api/turn-credentials.ts` issues 20-minute coturn REST credentials by default. The username contains the Unix expiry plus a random request id, and the credential is `base64(HMAC-SHA1(TURN_SHARED_SECRET, username))`. Responses are same-origin `GET` only and carry `Cache-Control: no-store`.

## Fallback Behavior

`CallPage.tsx` monitors each current-generation transport without changing the local Peer ID:

- `new`, `checking`, or `connecting` must establish within 15 seconds.
- `disconnected` receives a 5-second grace period; recovery is cancelled if the transport reconnects.
- `failed` recovers immediately.
- Guest reconnect delays are 0.5, 1, 2, 4, 8, and 15 seconds with up to 20 percent random jitter.
- The first media recovery keeps normal `on` mode. A repeated establishment failure promotes future connections to relay-only `force` when TURN is available.

Recovery role is based on stable session role, not the current URL shape:

- guest/caller closes stale media/control/bulk connections and creates replacements with bounded backoff.
- host/callee closes stale failed connections, applies the advertised TURN mode for future connections, and waits for the guest to reconnect.

`src/lib/connectionRecovery.ts` owns deadlines, backoff, and mode escalation. `src/lib/transportWatchdog.ts` attaches cancellable watchdogs to data transports. `src/lib/turnFallback.ts` maps recovery stages to user-facing status text; those labels describe enabled candidates or recovery mode, not proof of selected relay traffic.

Only the guest initiates outgoing media, control, and bulk connections. Only the host accepts incoming connections. Incoming metadata must name the active session, the guest role, the expected channel for data connections, and a `peerId` equal to the actual PeerJS connection peer. Wrong-session, wrong-role, wrong-channel, missing, and spoofed metadata are rejected. A healthy active connection is never replaced by an unsolicited duplicate.

Session-resume and decrypted application payloads are also bound to the currently active DataConnection peer. User hangup disables automatic reconnect; a disconnected host returns to the waiting state.

## Media Acquisition

`src/hooks/useMediaStream.ts` uses generation tracking for asynchronous `getUserMedia` requests. A quality/device change keeps the current stream alive until the latest replacement succeeds. Results from stale requests and results arriving after cleanup are stopped immediately, preventing late requests from replacing or leaking tracks.

The host's initial microphone and camera state is serialized by `src/lib/callSession.ts`. `audio=0` or `video=0` disables that media kind for both sides at startup; missing parameters preserve the historical enabled defaults. `src/lib/mediaDevicePolicy.ts` converts those defaults into selective constraints:

- video meeting: request microphone and camera
- voice-only meeting: request microphone only
- text-only meeting: do not call `getUserMedia`

The home page does not acquire media automatically. Before preview starts, its microphone and camera controls change only the defaults that will be encoded into a new meeting. The explicit preview action requests the currently enabled devices. A pasted invite can therefore navigate to the call page before any permission request and use the invite's own defaults.

For each initially disabled media kind, the app creates a disabled silent or black placeholder track without accessing hardware. This keeps the corresponding PeerJS sender negotiated, so manually enabling the control later can request only that device and replace the placeholder without restarting media, chat, or file transports. A failed on-demand device request leaves the placeholder and disabled control state intact.

## Diagnostics

`src/components/NetworkDiagnosticsPanel.tsx` shows a compact collapsed state and full details when expanded.

Tracked details include:

- app version and build time
- PeerJS plus separate media, chat-control, and bulk-file ICE/PeerConnection status
- local/remote track counts
- inbound/outbound codec
- video bitrate
- connection up/down bandwidth
- selected candidate TURN relay usage for each transport. `未选中` means the selected candidate pair is not relay; TURN may still have been offered during ICE candidate gathering.
- dynamic/static credential source and dynamic expiry time, without displaying URLs, usernames, credentials, secrets, or server addresses
- TURN fallback status
- optional network candidate probe

`src/lib/mediaStats.ts` parses WebRTC stats. `src/lib/networkDiagnostics.ts` performs candidate collection and risk heuristics.

## Chat And DataChannel

The reliable control DataConnection carries:

- heart reactions
- quality-change events
- session-resume metadata
- chat key exchange
- encrypted chat messages and file-transfer control messages

The reliable bulk DataConnection carries only encrypted binary file frames. Keeping file bytes off the control channel prevents large transfers from blocking chat, reactions, reconnect metadata, and transfer acknowledgements. The channel labels are `svc-control-v2` and `svc-file-bulk-v2`; both use PeerJS `serialization: 'binary'` and `reliable: true`.

Chat and file payloads use an application-layer ECDH P-256 and AES-GCM exchange. Binary file frames are encrypted as bytes rather than converted to base64. This encryption does not provide independent identity verification; the invite URL remains a bearer capability and the active PeerJS connection is treated as the session authority.

Chat payloads support text, previewable image attachments, and downloadable non-image file attachments. Images remain inline chat attachments. Non-image file transfer is confirmation-first:

1. The sender emits an encrypted file offer on the control channel.
2. The receiver accepts or declines. Acceptance grants an initial 1MiB credit window.
3. The sender reads raw 256KiB slices. Each binary frame contains a 4-byte metadata length, UTF-8 JSON metadata, and raw file bytes, then the complete frame is AES-GCM encrypted and sent on the bulk channel.
4. The receiver validates transfer ID, offset, declared size, and chunk bounds before writing. Credit is replenished only after bytes are written to disk or the bounded memory fallback.
5. The sender remains in the transferring state at 100% until the receiver closes the destination and sends the final completion acknowledgement.

PeerJS may internally re-chunk large binary messages at its browser-safe threshold. Keep that behavior enabled. Application-level credit controls how much unacknowledged file data may be in flight instead of relying only on `RTCDataChannel.bufferedAmount`.

If a transient control or bulk disconnect occurs, transfer state and the receiver file handle are retained. After key and bulk reconnection, the receiver advertises the persisted byte offset with resume credit and the sender continues from that offset. User hangup, unmount, decline, or terminal protocol errors abort and release transfer resources.

Transfer progress is published to chat UI state at start, completion, and then at most every 250ms or every 1MiB of transferred bytes during active streaming. This keeps speed/remaining-time feedback current without re-rendering the chat panel for every chunk.

Non-image file offers are accepted up to 2GiB. When the browser supports the File System Access API, accepted files are streamed to the receiver's chosen disk path. Browsers without `showSaveFilePicker` fall back to memory-backed chunks and a `blob:` download URL after completion, but that memory fallback remains capped at 10MiB to avoid loading very large files into RAM. Regular `CHAT_MESSAGE` payloads must not carry non-image file `dataUrl` values.

Chat message content, file data, and drafts are memory-only. The store keeps at most 200 messages and revokes evicted `blob:` download URLs. Old persisted chat keys are cleaned up opportunistically. Do not add localStorage persistence for attachments without an explicit privacy/product decision.

## TURN Operations Notes

Keep actual TURN host, username, and credential values out of committed docs. Use placeholders such as `<TURN_HOST>` when documenting shape.

Current expected TURN URL shape:

```text
turn:<TURN_HOST>:3478?transport=udp
turn:<TURN_HOST>:3478?transport=tcp
turns:<TURN_HOST>:443?transport=tcp
```

Current production infrastructure was observed on 2026-07-13 with only UDP/TCP 3478, TLS disabled, and relay ports 49160-49200. The target migration is a DNS-only TURN hostname, shared-secret coturn REST authentication, `turns:` on TCP/TLS 443, and a wider relay UDP range opened identically in coturn, the host firewall, and the Alibaba Cloud security group.

Migration order is mandatory:

1. Prepare DNS, certificate, firewall/security group, wider relay range, quotas, and a tested coturn rollback.
2. Configure matching coturn and Pages shared secrets in one maintenance window.
3. Deploy the credential Function and retain static frontend fallback temporarily.
4. Verify relay candidate gathering and a real `turn=force` call over UDP 3478 and TLS 443.
5. Remove static frontend username/credential values only after those checks pass.

If TURN behavior changes, update `src/lib/iceConfig.ts`, related tests, README, this file, and `.codex/PROJECT_CONTEXT.md`.
