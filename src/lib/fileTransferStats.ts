const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * 1024;

const formatOneDecimal = (value: number) => (
  Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
);

export function formatFileTransferSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '-';

  if (bytesPerSecond >= BYTES_PER_MIB) {
    return `${formatOneDecimal(bytesPerSecond / BYTES_PER_MIB)} MB/s`;
  }

  if (bytesPerSecond >= BYTES_PER_KIB) {
    return `${formatOneDecimal(bytesPerSecond / BYTES_PER_KIB)} KB/s`;
  }

  return `${Math.round(bytesPerSecond)} B/s`;
}

export function formatFileTransferTimeRemaining(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';

  const wholeSeconds = Math.ceil(seconds);
  if (wholeSeconds < 60) return `${wholeSeconds} 秒`;

  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (minutes < 60) return `${minutes} 分${remainingSeconds > 0 ? ` ${remainingSeconds} 秒` : ''}`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} 小时${remainingMinutes > 0 ? ` ${remainingMinutes} 分` : ''}`;
}
