import { describe, expect, it } from 'vitest';
import { deriveTurnFallbackAction, turnFallbackStatusLabel } from './turnFallback';

describe('turnFallback', () => {
  it('asks the caller to retry with TURN after direct transport failure', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('retry');
  });

  it('asks the callee to wait for the caller after enabling TURN fallback', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'callee',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'connecting',
      })
    ).toBe('wait');
  });

  it('does not retry when TURN is unavailable, already enabled, or already attempted', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: false,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('none');

    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'on',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('none');

    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: true,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('none');
  });

  it('does not retry for transient non-failed transport states', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'disconnected',
        peerConnectionState: 'connecting',
      })
    ).toBe('none');
  });

  it('describes candidate enablement separately from selected relay transport', () => {
    expect(turnFallbackStatusLabel('reconnecting')).toBe('连接中断，正在自动重连');
    expect(turnFallbackStatusLabel('waiting-peer')).toBe('连接中断，等待对方重连');
    expect(turnFallbackStatusLabel('retrying')).toBe('连接失败，已启用 TURN 候选并重试');
    expect(turnFallbackStatusLabel('waiting')).toBe('连接失败，已启用 TURN 候选，等待对方重连');
    expect(turnFallbackStatusLabel('relay-only')).toBe('连接持续失败，正在强制 TURN 中继');
    expect(turnFallbackStatusLabel('exhausted')).toBe('自动重连已暂停，请手动重试');
    expect(turnFallbackStatusLabel('active')).toBe('TURN 候选已启用，连接已恢复');
  });
});
