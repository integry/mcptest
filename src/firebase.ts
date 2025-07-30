import { initializeApp, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics } from "firebase/analytics";
import { getAuth, Auth } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBd3khQXFietKB7Vk9xj6QwZKMEx4EFQkc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "mcptest-a530d.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "mcptest-a530d",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "mcptest-a530d.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "407681337940",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:407681337940:web:711aec0743f8522e7fbbc1",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-RZDRCR2MSB"
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
      throw new Error('Missing required Firebase configuration values');
    }
    
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    
    // Ensure we are in a browser environment before getting analytics
    if (typeof window !== 'undefined') {
      analytics = getAnalytics(app);
    }
    
    console.log('Firebase initialized successfully for project:', firebaseConfig.projectId);
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    console.warn("Google authentication will not be available");
  }
} else {
  console.log('Firebase authentication is disabled via VITE_FIREBASE_AUTH_ENABLED');
}

export { app, analytics, auth };