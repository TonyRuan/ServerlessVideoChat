export const DEFAULT_PUBLIC_APP_URL = 'https://chat.uavserver.cn/';

interface PublicAppBaseUrlOptions {
  configuredUrl?: string;
  isNative: boolean;
  origin: string;
  basePath: string;
}

const ensureTrailingSlash = (value: string) => `${value.replace(/\/+$/, '')}/`;

export function resolvePublicAppBaseUrl({
  configuredUrl,
  isNative,
  origin,
  basePath,
}: PublicAppBaseUrlOptions) {
  const configured = configuredUrl?.trim();
  if (configured) return ensureTrailingSlash(configured);
  if (isNative) return DEFAULT_PUBLIC_APP_URL;
  return ensureTrailingSlash(`${origin}${basePath}`);
}

export function resolveTurnCredentialsEndpoint({
  configuredEndpoint,
  isNative,
  publicAppBaseUrl,
}: {
  configuredEndpoint?: string;
  isNative: boolean;
  publicAppBaseUrl: string;
}) {
  const configured = configuredEndpoint?.trim();
  if (configured) return configured;
  if (!isNative) return undefined;
  return new URL('api/turn-credentials', ensureTrailingSlash(publicAppBaseUrl)).toString();
}
