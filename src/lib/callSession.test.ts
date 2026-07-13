import { describe, expect, it } from 'vitest';
import {
  buildCallSessionHash,
  buildInviteLink,
  createCallSessionId,
  parseInviteInput,
  parseCallSessionHash,
  resolveCallSessionState,
} from './callSession';

describe('callSession', () => {
  it('parses session state from URL hash without local storage', () => {
    expect(parseCallSessionHash('#session=session-1&role=host&peer=peer_123')).toEqual({
      sessionId: 'session-1',
      role: 'host',
      peerId: 'peer_123',
    });
  });

  it('builds URL hash with optional peer id', () => {
    expect(buildCallSessionHash({ sessionId: 'session-1', role: 'guest' })).toBe('#session=session-1&role=guest');
    expect(buildCallSessionHash({ sessionId: 'session-1', role: 'host', peerId: 'peer-1' })).toBe(
      '#session=session-1&role=host&peer=peer-1'
    );
  });

  it('builds invite links with the guest role and shared session id', () => {
    expect(buildInviteLink('https://chat.example.com/', 'host-peer', 'session-1')).toBe(
      'https://chat.example.com/call/host-peer#session=session-1&role=guest'
    );
  });

  it('rejects missing session or invalid peer ids', () => {
    expect(parseCallSessionHash('#role=host&peer=peer-1')).toBeNull();
    expect(parseCallSessionHash('#session=session-1&role=host&peer=http://bad')).toEqual({
      sessionId: 'session-1',
      role: 'host',
    });
  });

  it('creates URL-safe session ids', () => {
    expect(createCallSessionId()).toMatch(/^[A-Za-z0-9_-]{12,}$/);
  });

  it('keeps the active peer while a router hash update is still catching up', () => {
    const current = {
      sessionId: 'session-1',
      role: 'guest' as const,
      peerId: 'host-peer',
    };

    expect(resolveCallSessionState(
      '#session=session-1&role=guest',
      current,
      'host-peer'
    )).toEqual(current);
  });

  describe('parseInviteInput', () => {
    it('parses complete HTTP and HTTPS invite URLs', () => {
      expect(parseInviteInput('https://chat.example.com/call/host-peer#session=session-1&role=host')).toEqual({
        peerId: 'host-peer',
        sessionId: 'session-1',
      });
      expect(parseInviteInput('http://localhost:5173/call/peer_123#session=session_2')).toEqual({
        peerId: 'peer_123',
        sessionId: 'session_2',
      });
    });

    it('allows a deployment subpath before the call route', () => {
      expect(
        parseInviteInput(
          'https://example.github.io/ServerlessVideoChat/call/host-peer#session=session-1&role=guest'
        )
      ).toEqual({
        peerId: 'host-peer',
        sessionId: 'session-1',
      });
    });

    it('rejects bare peer ids and relative call paths', () => {
      expect(parseInviteInput('host-peer')).toBeNull();
      expect(parseInviteInput('/call/host-peer#session=session-1')).toBeNull();
    });

    it('rejects unsupported schemes and missing or invalid sessions', () => {
      expect(parseInviteInput('ftp://chat.example.com/call/host-peer#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/host-peer')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/host-peer#session=bad%2Fsession')).toBeNull();
    });

    it('rejects lookalike or incomplete call paths', () => {
      expect(parseInviteInput('https://chat.example.com/callback/host-peer#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/callish/host-peer#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/host-peer/extra#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/#session=session-1')).toBeNull();
    });

    it('rejects invalid peer ids, including encoded path separators', () => {
      expect(parseInviteInput('https://chat.example.com/call/ab#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/bad.peer#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/bad%2Fpeer#session=session-1')).toBeNull();
      expect(parseInviteInput('https://chat.example.com/call/bad%5Cpeer#session=session-1')).toBeNull();
    });
  });
});
