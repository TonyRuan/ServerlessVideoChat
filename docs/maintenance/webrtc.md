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

- guest/caller closes old media/data connections and retries with TURN enabled.
- host/callee enables TURN for later connections and waits for caller reconnect.

`src/lib/turnFallback.ts` derives these actions from role, fallback status, TURN availability, and ICE/PeerConnection state.

Incoming PeerJS media/data connections must match the active session metadata. Wrong-session or missing-session incoming connections are rejected before they can take over the page state.

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

DataConnection currently carries:

- heart reactions
- quality-change events
- session-resume metadata
- chat key exchange
- encrypted chat payloads

Chat messages use WebRTC DataChannel transport plus an application-layer ECDH P-256 and AES-GCM exchange. This does not provide independent identity verification; it assumes the existing PeerJS/WebRTC connection is the session authority.

Chat message content and drafts are memory-only. Old persisted chat keys are cleaned up opportunistically.

## TURN Operations Notes

Keep actual TURN host, username, and credential values out of committed docs. Use placeholders such as `<TURN_HOST>` when documenting shape.

Current expected TURN URL shape:

```text
turn:<TURN_HOST>:3478?transport=udp
turn:<TURN_HOST>:3478?transport=tcp
```

If TURN behavior changes, update `src/lib/iceConfig.ts`, related tests, README, this file, and `.codex/PROJECT_CONTEXT.md`.
