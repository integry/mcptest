/** Firebase build-time configuration, readable without loading the SDK. */
export const getFirebaseConfig = () => ({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
});

/** Read at call time (not module load) so the env can differ per test case. */
export const isFirebaseAuthEnabled = (): boolean => import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';

/** True when the build carries enough configuration for Firebase to start. */
export const hasFirebaseConfig = (): boolean => {
  const config = getFirebaseConfig();
  return Boolean(isFirebaseAuthEnabled() && config.apiKey && config.projectId && config.authDomain);
};

/** True when the build can report analytics (auth enabled and a measurement id set). */
export const isFirebaseAnalyticsConfigured = (): boolean => Boolean(hasFirebaseConfig() && getFirebaseConfig().measurementId);
