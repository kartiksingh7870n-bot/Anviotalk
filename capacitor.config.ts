import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anviotalk.app',
  appName: 'Anvio Talk',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'anviotalk.in'
  },
  plugins: {
    // =========================================================================
    // MANUAL ACTION REQUIRED FOR ANDROID BUILD:
    // 1. Replace 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com' with your Web OAuth Client ID from Google Cloud Console.
    //    (Do NOT use the Android Client ID here — Firebase requires the Web OAuth Client ID to exchange the idToken).
    // 2. Ensure 'android/app/google-services.json' exists in your Android project.
    // =========================================================================
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ["google.com"],
      clientId: "1059844371114-cmtloapcph81l56l15tisatpgs7tsmn4.apps.googleusercontent.com"
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    Keyboard: {
      resize: 'body'
    }
  }
};

export default config;
