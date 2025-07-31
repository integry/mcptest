import { initializeApp, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics } from "firebase/analytics";
import { getAuth, Auth } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ""
};

// Initialize Firebase only if authentication is enabled
let app: FirebaseApp | null = null;
let analytics: Analytics | null = null;
let auth: Auth | null = null;

const isAuthEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';

if (isAuthEnabled) {
  try {
    // Validate required configuration
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.authDomain) {
      throw new Error('Missing required Firebase configuration values. Please configure your Firebase environment variables.');
    }
    
    // Check if we're using default/empty values
    if (firebaseConfig.apiKey === "" || firebaseConfig.projectId === "" || firebaseConfig.authDomain === "") {
      console.warn('Firebase configuration is missing. Authentication will not be available.');
      console.warn('Please set the following environment variables:');
      console.warn('- VITE_FIREBASE_API_KEY');
      console.warn('- VITE_FIREBASE_AUTH_DOMAIN');
      console.warn('- VITE_FIREBASE_PROJECT_ID');
      console.warn('- VITE_FIREBASE_STORAGE_BUCKET');
      console.warn('- VITE_FIREBASE_MESSAGING_SENDER_ID');
      console.warn('- VITE_FIREBASE_APP_ID');
      // Don't initialize Firebase with empty config
    } else {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      
      // Ensure we are in a browser environment before getting analytics
      if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
        analytics = getAnalytics(app);
      }
      
      console.log('Firebase initialized successfully for project:', firebaseConfig.projectId);
    }
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    console.warn("Google authentication will not be available");
  }
} else {
  console.log('Firebase authentication is disabled via VITE_FIREBASE_AUTH_ENABLED');
}

export { app, analytics, auth };