# Experimental WebTransport file relay

This service pairs two browser sessions and forwards encrypted file frames. It does not save files or possess the application's AES keys. Existing WebRTC control messages carry offers, acceptance, persisted-byte credit, completion and errors. A WebTransport failure is reported explicitly; this experimental channel does not silently downgrade or claim automatic resume.

## Build and test

Go 1.27.3, quic-go 0.62.0, webtransport-go 0.13.0 are pinned by go.mod/go.sum.

```sh
go test ./...
go build -o svc-webtransport-relay .
```

Windows uses the same commands with an `.exe` output name. The repository's local benchmark toolchain can be used without installing Go globally.

## Wire contract

- HTTPS WebTransport CONNECT `/file`, no query parameters.
- Exactly one application bidirectional stream per session.
- First message is a four-byte unsigned big-endian length (1–512), then UTF-8 JSON: `{"version":1,"room":"<64 lowercase hex characters>","role":"send"}`. The other role is `receive`.
- The random 256-bit room capability is exchanged only inside the existing encrypted control connection. It is not a transfer ID, URL parameter, file name, log field, or persistent chat history field.
- Once both distinct roles are attached, the relay writes byte `82` to both streams.
- Sender writes frames as four-byte big-endian body length, then 12-byte AES-GCM IV and ciphertext+tag. The relay validates size bounds (29–266268 bytes) and forwards the frame unchanged to the receiver. The browser validates authenticated metadata, peer, transfer ID, offset and exact chunk size.
- No acknowledgements travel backward through this stream; persisted offsets and final completion use the encrypted WebRTC control channel.
- Sender stream EOF forwards FIN to the receiver, allowing up to five seconds before closing sessions. Either endpoint session closing terminates the paired session and releases its room.

## Configuration and deployment

Use `relay.env.example` as a template. `WT_CERT_FILE` and `WT_KEY_FILE` are required; the server never generates an insecure production certificate. `WT_ORIGINS` is an exact comma-separated allowlist with no trailing slash. HTTP origins are accepted only for `localhost`/`127.0.0.1` development. Only these origins can upgrade. Origin checks are a browser access control, not user authentication; native clients can forge an Origin. This public experimental service should have operator monitoring and network-level traffic quotas before Internet exposure.

By default the listener binds only `127.0.0.1:4433`. Production must explicitly set e.g. `WT_BIND=0.0.0.0:443`, provision DNS-only hostname and a valid certificate, and allow the selected UDP port in the host firewall and cloud security group. TCP 443 and UDP 443 are separate sockets, but check both before changing listeners. The SPA can stay on Cloudflare Pages; this UDP HTTP/3 service cannot be implemented as a Pages Function. Configure frontend `VITE_WEBTRANSPORT_URL=https://<relay-host>/file` for both peers.

`svc-webtransport.service.example` uses an unprivileged dedicated user. Provision the directory and certificate read permission for that user, restart after certificate renewal, and place the concrete environment file outside the checkout. Do not commit private keys or certificates. A reverse proxy must explicitly support forwarding this HTTP/3 WebTransport connection; a normal HTTPS HTTP/1.1 reverse proxy is not sufficient.

Resource bounds: 64 rooms / 128 admitted sessions globally and 16 sessions per remote IP by default (configurable positive integers); 10-second session/handshake readiness; 25-second peer pairing; 60-second blocked read/write timeout per frame; 60-minute maximum session; 2 GiB plus 64 MiB framing allowance per file. Relayed bytes use a 64 KiB copy buffer per active room; QUIC receive windows are capped. Duplicate roles are rejected without evicting an existing peer. Pending rooms and IP quota leases are released on disconnect, timeout or protocol error. Limits constrain simultaneous resource use, not long-term transfer bandwidth or billing.

## Local integration test

Use a short-lived localhost ECDSA certificate from the existing benchmark fixture, set the three certificate/origin variables and start the built relay. Frontend development supports a localhost-only certificate fingerprint setting; production should use public PKI. No localhost private key belongs in this directory or Git. Keep local bind and origin explicit, and stop the test process after browser verification.

This directory does not deploy automatically. Production needs a verified hostname, TLS certificate, UDP reachability and frontend endpoint configuration before the experimental option becomes available.
