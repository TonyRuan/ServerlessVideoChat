import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tonyruan.serverlessvideochat',
  appName: 'SVC 设备桥',
  webDir: 'dist',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
