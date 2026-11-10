import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexus3d.studio',
  appName: 'Nexus3D',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    backgroundColor: '#090d16',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
