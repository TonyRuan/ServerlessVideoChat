# TURN Reliability And Recovery Design

## Objective

Improve real-world call recovery and TURN security without replacing PeerJS or changing the one-to-one meeting model. The guest remains the only connection initiator, the host remains passive, and Cloudflare Pages remains the application host.

## Chosen Approach

Use an incremental migration:

1. Harden client recovery while retaining the current static TURN configuration.
2. Add a same-origin Cloudflare Pages Function that issues short-lived coturn REST credentials.
3. Migrate coturn to shared-secret authentication only after the function and client fallback are deployed.
4. Add TLS TURN on port 443 and expand the relay port range only after DNS and cloud firewall rules are ready.

A native single-`RTCPeerConnection` rewrite is out of scope. Media, control, and bulk connections remain separate because replacing PeerJS connection ownership at the same time as recovery and credential changes would create an unnecessarily large regression surface.

## ICE And Credential Configuration

- TURN mode remains `on` by default. Initial ICE gathering includes STUN and TURN candidates, while `force` remains relay-only.
- The base STUN list is reduced to Cloudflare STUN plus one Google STUN endpoint.
- The browser first requests `GET /api/turn-credentials` with a short timeout.
- A successful response contains TURN URLs, username, credential, and expiration time. Responses are validated before use and are never cached.
- During migration and local development, a complete static `VITE_TURN_*` configuration remains a fallback if the endpoint is unavailable.
- Short-lived credentials are refreshed before expiry. Refreshed configuration applies to future PeerJS connections; existing healthy connections are not interrupted.
- Production migration is complete only after static TURN username and credential values are removed from the frontend build environment.

## Connection Recovery

- A new connection attempt has a 15-second establishment deadline.
- A `disconnected` transport receives a 5-second grace period. Returning to `connected` cancels recovery.
- A `failed` transport recovers immediately.
- Only the guest creates replacement media, control, and bulk connections. The host closes stale failed connections and returns to waiting.
- Retry delays are 0.5, 1, 2, 4, 8, and 15 seconds with up to 20 percent random jitter.
- The first recovery keeps normal `on` mode. Repeated media failure promotes future connections to `force` when usable TURN configuration exists. Relay-only is a last recovery stage, never the default.
- User hangup and component teardown cancel every watchdog and retry timer.
- File transfer state remains resumable across control or bulk replacement and is not aborted by transient recovery.

## Diagnostics

- Collapsed diagnostics continue to show only the overall connection state.
- Expanded diagnostics distinguish media, control, and bulk transport states.
- Each channel reports its own selected candidate type and TURN usage when stats are available.
- UI wording distinguishes "TURN candidates enabled" from "selected relay path". A fallback status alone is not proof that traffic is relayed.
- Credential source and expiry health are shown without exposing URLs, usernames, credentials, secrets, or server IPs.

## Cloudflare Credential Function

- `GET /api/turn-credentials` runs as a Pages Function.
- The function uses a secret `TURN_SHARED_SECRET` and coturn REST HMAC-SHA1 credentials with a 20-minute TTL.
- The credential username contains expiration plus a random request identifier.
- The function accepts only same-origin `GET` requests, returns `Cache-Control: no-store`, and does not log credential material.
- TURN URLs are supplied through a server-side `TURN_URLS` variable so multiple same-credential endpoints can be returned later.
- Abuse protection relies on short TTL, coturn quotas, Cloudflare request rate limiting, and monitoring rather than durable per-user state.

## Coturn Migration

- Use a DNS-only hostname such as `turn.uavserver.cn`; Cloudflare's regular HTTP proxy must not proxy TURN traffic.
- Keep UDP/TCP 3478 and add `turns:` over TCP/TLS 443.
- Replace the static user with coturn `use-auth-secret` only during the coordinated migration window.
- Expand the current narrow relay range and open the identical UDP range in the host firewall and Alibaba Cloud security group.
- Configure per-user and total quotas, stale nonce handling, and a certificate renewal hook that restarts coturn after renewal.
- A second TURN server remains a future infrastructure task; the client and credential response must support multiple URLs now.

## Failure Handling And Rollback

- If dynamic credentials cannot be fetched during migration, the browser uses the complete static configuration.
- Invalid or expired dynamic responses are ignored rather than partially applied.
- If coturn migration fails, restore the backed-up configuration and restart coturn before changing the frontend environment.
- TLS and expanded relay ports are activated only after external connectivity checks pass.
- No secret value is committed, printed, returned in diagnostics, or added to maintenance documentation.

## Verification

- Unit tests cover credential validation, expiry, recovery deadlines, jitter bounds, retry exhaustion, and recovery-mode promotion.
- Existing TURN, call policy, file resume, crypto, and diagnostics tests remain green.
- Required checks are `npm test`, `npm run check`, `npm run lint`, and `npm run build`.
- Browser tests use fake media devices and two isolated contexts to exercise initial connection, forced relay, disconnect recovery, and control/bulk status without granting real device permission.
- Server verification includes relay candidate gathering over UDP 3478 and TLS 443, credential expiry rejection, coturn service health, and external relay-port reachability.
