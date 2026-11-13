import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexus3d.studio.phase1',
  appName: 'Nexus3D Phase1',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#090d16',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
