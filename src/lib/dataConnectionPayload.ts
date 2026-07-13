export const DATA_CONNECTION_OPTIONS = {
  serialization: 'binary',
  reliable: true,
} as const;

export type DataConnectionChannel = 'control' | 'bulk';

export function createDataConnectionOptions(channel: DataConnectionChannel) {
  return {
    ...DATA_CONNECTION_OPTIONS,
    label: channel === 'control' ? 'svc-control-v2' : 'svc-file-bulk-v2',
  } as const;
}

export const DATA_CONNECTION_BUFFER_LIMIT_BYTES = 4 * 1024 * 1024;

export interface DataConnectionPayloadSender {
  open: boolean;
  send: (data: unknown, chunked?: boolean) => void | Promise<void>;
}

export function sendDataConnectionPayload(
  conn: DataConnectionPayloadSender,
  payload: unknown
) {
  if (!conn.open) throw new Error('聊天连接尚未建立');
  return conn.send(payload, false);
}
