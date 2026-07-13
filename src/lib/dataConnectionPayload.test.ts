import { describe, expect, it, vi } from 'vitest';
import {
  DATA_CONNECTION_BUFFER_LIMIT_BYTES,
  DATA_CONNECTION_OPTIONS,
  createDataConnectionOptions,
  sendDataConnectionPayload,
} from './dataConnectionPayload';

describe('dataConnectionPayload', () => {
  it('uses binary ordered data connections for rolling-deploy compatibility', () => {
    expect(DATA_CONNECTION_OPTIONS).toEqual({
      serialization: 'binary',
      reliable: true,
    });
  });

  it('allows multiple encrypted 256 KiB file chunks to queue before backpressure waits', () => {
    expect(DATA_CONNECTION_BUFFER_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  });

  it('uses stable labels for isolated control and bulk channels', () => {
    expect(createDataConnectionOptions('control')).toEqual({
      ...DATA_CONNECTION_OPTIONS,
      label: 'svc-control-v2',
    });
    expect(createDataConnectionOptions('bulk')).toEqual({
      ...DATA_CONNECTION_OPTIONS,
      label: 'svc-file-bulk-v2',
    });
  });

  it('sends object payloads over the compatible binary connection', () => {
    const conn = {
      open: true,
      send: vi.fn(),
    };
    const payload = { type: 'SESSION_RESUME', version: 1 };

    sendDataConnectionPayload(conn, payload);

    expect(conn.send).toHaveBeenCalledWith(payload, false);
  });
});
