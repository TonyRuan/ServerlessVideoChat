# WebRTC, PeerJS, And TURN

PeerJS handles signaling. Browser WebRTC carries media and DataConnection payloads.

## ICE Configuration

`src/lib/iceConfig.ts` owns RTC configuration generation.

Default behavior is `on`: when a complete TURN configuration is present, initial PeerJS RTC config includes STUN plus TURN candidates. This improves cross-network and cross-carrier success at the cost of possible TURN candidate allocation and relay usage when direct transport is not chosen.

TURN mode can be overridden by URL query/hash or `VITE_TURN_MODE`:

- `turn=0`, `turn=false`, or `turn=off`: disable initial TURN candidates.
- `turn=1`, `turn=true`, or `turn=on`: include TURN candidates.
- `turn=force` or `turn=relay`: set relay-only ICE policy for diagnostics. If no TURN URL is configured, this intentionally produces relay-only config without usable relay servers, so the connection should fail instead of silently falling back to STUN.

URL values override `VITE_TURN_MODE`.

A TURN config is considered complete only when it has at least one TURN URL plus both username and credential. URL-only or partial-credential TURN config is ignored for the current coturn-style deployment.

## Fallback Behavior

When TURN is explicitly off and direct transport fails, `CallPage.tsx` can enable TURN fallback without changing the local Peer ID. Fallback role is based on stable session role, not the current URL shape:

- guest/caller closes failed media/control/bulk connections and retries with bounded backoff and TURN enabled.
- host/callee enables TURN for later connections and waits for the guest to reconnect.

`src/lib/turnFallback.ts` derives these actions from role, fallback status, TURN availability, and ICE/PeerConnection state.

Only the guest initiates outgoing media, control, and bulk connections. Only the host accepts incoming connections. Incoming metadata must name the active session, the guest role, the expected channel for data connections, and a `peerId` equal to the actual PeerJS connection peer. Wrong-session, wrong-role, wrong-channel, missing, and spoofed metadata are rejected. A healthy active connection is never replaced by an unsolicited duplicate.

Session-resume and decrypted application payloads are also bound to the currently active DataConnection peer. User hangup disables automatic reconnect; a disconnected host returns to the waiting state.

## Media Acquisition

`src/hooks/useMediaStream.ts` uses generation tracking for asynchronous `getUserMedia` requests. A quality/device change keeps the current stream alive until the latest replacement succeeds. Results from stale requests and results arriving after cleanup are stopped immediately, preventing late requests from replacing or leaking tracks.

## Diagnostics

`src/components/NetworkDiagnosticsPanel.tsx` shows a compact collapsed state and full details when expanded.

Tracked details include:

- app version and build time
- PeerJS, ICE, and PeerConnection status
- local/remote track counts
- inbound/outbound codec
- video bitrate
- connection up/down bandwidth
- selected candidate TURN relay usage. `未选中` means the selected candidate pair is not relay; TURN may still have been offered during ICE candidate gathering.
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
```

If TURN behavior changes, update `src/lib/iceConfig.ts`, related tests, README, this file, and `.codex/PROJECT_CONTEXT.md`.
