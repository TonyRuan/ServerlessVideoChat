import { describe, expect, it } from 'vitest';
import {
  buildCallSessionHash,
  buildInviteLink,
  createCallSessionId,
  parseCallSessionHash,
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
});
