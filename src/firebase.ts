import { initializeApp, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics } from "firebase/analytics";
import { getAuth, Auth } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBd3khQXFietKB7Vk9xj6QwZKMEx4EFQkc",
  authDomain: "mcptest-a530d.firebaseapp.com",
  projectId: "mcptest-a530d",
  storageBucket: "mcptest-a530d.firebasestorage.app",
  messagingSenderId: "407681337940",
  appId: "1:407681337940:web:711aec0743f8522e7fbbc1",
  measurementId: "G-RZDRCR2MSB"
};

// Initialize Firebase
let app: FirebaseApp;
let analytics: Analytics | null = null;
let auth: Auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Ensure we are in a browser environment before getting analytics
  if (typeof window !== 'undefined') {
    analytics = getAnalytics(app);
  }
} catch (error) {
  console.error("Firebase initialization failed:", error);
}

export { app, analytics, auth };