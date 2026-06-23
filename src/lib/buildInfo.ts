const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const buildTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

const pad2 = (value: number) => String(value).padStart(2, '0');

export function formatBuildTime(value: string) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  ].join(' ');
}

export const BUILD_INFO = {
  version: appVersion,
  buildTime,
  label: `v${appVersion} · built ${formatBuildTime(buildTime)}`,
};
