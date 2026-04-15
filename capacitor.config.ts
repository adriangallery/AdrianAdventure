import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zeroadventures.zeroadventure2',
  appName: 'ZEROadventure II',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#06060c',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#06060c',
      launchShowDuration: 0,
    },
  },
};

export default config;
