# Connection And Transfer Hardening Design

## Objective

Harden the current one-to-one call workflow without changing the frontend-only deployment model. The work must improve connection ownership, session binding, large-file streaming, protocol validation, memory behavior, and call controls while preserving Cloudflare root hosting and GitHub Pages subpath hosting.

## Stage 1: Connection Ownership And Media Lifecycle

- The guest is the only side that initiates media and data connections. The host only accepts connections.
- Incoming connections are accepted only when metadata contains the active session ID, the opposite role, and a `peerId` equal to PeerJS `connection.peer`.
- An open connection cannot be replaced by a second peer. A failed or closed connection can be replaced only through a new connection generation.
- Guest reconnects use bounded exponential backoff. Host close/error handling returns to waiting state.
- User-initiated hang-up and component teardown disable reconnect before closing connections.
- Media acquisition is generation-based. A late `getUserMedia` result is stopped and ignored, and the existing stream remains active until the latest replacement succeeds.

## Stage 2: Large File Transport

- The existing encrypted control DataConnection carries chat, offers, acceptance, credit, completion, and errors.
- A second reliable binary DataConnection carries only encrypted file chunks. This prevents bulk payloads from filling the control channel.
- File chunks remain 256 KiB, but raw bytes are encoded in a binary frame and encrypted directly with AES-GCM. No file-byte base64 layer is used.
- The receiver grants an initial bounded byte window after accepting a file. It replenishes credit only after bytes have been written to disk or accepted into the bounded small-file fallback.
- The sender cannot advance beyond granted credit. Receiver-side asynchronous queues therefore remain bounded by the credit window.
- A transfer is marked sent only after the receiver closes the file successfully and sends a completion acknowledgement.
- Transfer state survives transient DataConnection reconnects. The receiver advertises the persisted offset after the replacement encrypted control channel is ready, and the sender resumes from that offset.
- Invalid offsets, peer IDs, transfer IDs, or oversized frames fail the transfer and release resources.

## Stage 3: Protocol And Resource Boundaries

- All timestamps and numeric protocol fields must be finite and within explicit ranges.
- Quality-change and heart payloads are validated structurally before use.
- Decrypted payload `from` values and session-resume `peerId` values must equal the current PeerJS remote peer.
- Chat history has a bounded in-memory message count. Object URLs are revoked when messages are evicted or the conversation is reset.
- The home page accepts complete invitation links only. Bare PeerJS IDs are rejected instead of creating an unrelated session.
- Production builds omit source-location instrumentation and hidden source maps. Vite is updated to a patched 6.4 release, and the call route is lazy-loaded.

## Stage 4: UI And Architecture

- Every icon-only button has an accessible name and state where applicable.
- Auto-hidden controls are removed from keyboard navigation with `inert` and `aria-hidden`.
- Chat and mobile option panels receive dialog semantics, initial focus, Escape close behavior, and focus restoration.
- Reusable control-bar and auto-hide behavior are extracted from `CallPage.tsx`; connection and file protocol rules remain in pure, tested library modules.

## Compatibility And Security

- Missing connection metadata is rejected. This intentionally favors current-version safety over connecting to older unsafe clients.
- Invitation links remain bearer capabilities. ECDH/AES-GCM protects payload confidentiality but does not independently verify a human identity.
- TURN credentials in `VITE_*` remain frontend-visible until a separate short-lived credential service is introduced.
- Files remain memory-only unless the receiver explicitly chooses a disk destination. The memory fallback remains capped at 10 MiB.

## Verification

- Unit tests cover policies, binary frames, credit windows, protocol validation, media generations, and resource eviction.
- Required repository checks are `npm test`, `npm run check`, `npm run lint`, and `npm run build`.
- Browser verification covers home/join validation and desktop/mobile call controls using fake media devices; no real camera or microphone permission is approved.
