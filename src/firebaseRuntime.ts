/**
 * The Firebase SDK and its initialization. Nothing imports this module
 * statically: `src/firebase.ts` loads it with a dynamic import the first time
 * the app needs auth or analytics, so content pages never download the SDK.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAnalytics, logEvent, type Analytics } from 'firebase/analytics';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirebaseConfig, isFirebaseAuthEnabled } from './firebaseConfig';
import { isAnalyticsAllowed } from './utils/privacySignals';

export type { Analytics, Auth, FirebaseApp, User };

export interface FirebaseRuntime {
  app: FirebaseApp | null;
  auth: Auth | null;
  analytics: Analytics | null;
  GoogleAuthProvider: typeof GoogleAuthProvider;
  logEvent: typeof logEvent;
  onAuthStateChanged: typeof onAuthStateChanged;
  signInWithPopup: typeof signInWithPopup;
  signOut: typeof signOut;
}

let runtime: FirebaseRuntime | null = null;

/** Initializes Firebase once, with the same checks the eager module used to run at startup. */
export const initializeFirebaseRuntime = (): FirebaseRuntime => {
  if (runtime) return runtime;
  let app: FirebaseApp | null = null;
  let analytics: Analytics | null = null;
  let auth: Auth | null = null;
  const firebaseConfig = getFirebaseConfig();

  if (isFirebaseAuthEnabled()) {
    try {
      // Validate required configuration
      if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.authDomain) {
        console.warn('Firebase configuration is missing. Authentication will not be available.');
        console.warn('Please set the following environment variables:');
        console.warn('- VITE_FIREBASE_API_KEY');
        console.warn('- VITE_FIREBASE_AUTH_DOMAIN');
        console.warn('- VITE_FIREBASE_PROJECT_ID');
        console.warn('- VITE_FIREBASE_STORAGE_BUCKET');
        console.warn('- VITE_FIREBASE_MESSAGING_SENDER_ID');
        console.warn('- VITE_FIREBASE_APP_ID');
      } else {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);

        // Browser only, and never when Do Not Track or Global Privacy Control is
        // set. Page views are sent by logPageView with endpoint URLs redacted.
        if (isAnalyticsAllowed() && firebaseConfig.measurementId) {
          analytics = initializeAnalytics(app, { config: { send_page_view: false } });
        }

        console.log('Firebase initialized successfully for project:', firebaseConfig.projectId);
      }
    } catch (error) {
      console.error('Firebase initialization failed:', error);
      console.warn('Google authentication will not be available');
    }
  } else {
    console.log('Firebase authentication is disabled via VITE_FIREBASE_AUTH_ENABLED');
  }

  runtime = { app, auth, analytics, GoogleAuthProvider, logEvent, onAuthStateChanged, signInWithPopup, signOut };
  return runtime;
};
