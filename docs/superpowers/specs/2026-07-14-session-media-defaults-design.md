# Session Media Defaults Design

## Goal

Let the meeting creator define the initial camera and microphone state for the whole session. A guest joining a voice-only or text-only session must not be prompted for devices that are initially disabled, while either participant can enable those devices later.

## Behavior

- The host's camera and microphone state at creation time becomes the session default.
- The invite hash carries disabled defaults as `audio=0` and `video=0`; omitted values remain enabled for backward compatibility.
- A voice-only invite requests microphone access but not camera access.
- A text-only invite requests neither microphone nor camera access.
- Initial defaults do not permanently lock a device. Turning a disabled control on requests that device at that time.
- Existing invite links without media parameters continue to start with camera and microphone enabled.

## Architecture

`src/lib/callSession.ts` owns parsing and serializing the media defaults so the host URL, QR code, copied invite, and pasted invite all use one contract. `Home.tsx` captures the host's current control state when creating a meeting, and `CallPage.tsx` initializes its local stream from the parsed session defaults.

`useMediaStream.ts` requests only enabled hardware. For an initially disabled media kind, it creates a local silent or black placeholder track without accessing the corresponding device. The placeholder reserves the existing PeerJS sender so a later hardware track can replace it without closing the data channel or renegotiating the meeting. Placeholder tracks remain disabled and are never presented as an enabled local device.

## Failure Handling

- If an enabled device request fails, the existing media error path remains visible.
- If a browser cannot create a required placeholder track, media initialization reports an unsupported-browser error instead of claiming the requested session mode works.
- A failed later device request leaves the control disabled and keeps the existing placeholder active.

## Validation

- Unit tests cover backward-compatible hash parsing, disabled defaults, invite propagation, and media request policy.
- Type checking, linting, the full Vitest suite, and the production build must pass.
- Browser smoke testing must verify text-only and voice-only direct invite URLs without accepting camera/microphone prompts.
