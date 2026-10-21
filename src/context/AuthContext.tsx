import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  isFirebaseAuthEnabled,
  loadFirebase,
  setAuthSessionHint,
  shouldRestoreAuthSession,
  type FirebaseRuntime,
} from '../firebase';

interface AuthContextType {
  currentUser: User | null;
  /** True until the auth state is known; currentUser is null meanwhile. */
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Firebase is not part of the initial bundle. The provider only loads it when
 * the browser remembers a signed-in session (then `loading` stays true until
 * Firebase reports the user, exactly as before) or when the user signs in.
 * Anonymous visitors resolve to signed-out right after the first frame
 * without downloading the SDK. The first frame itself is the same for
 * everyone (auth "loading"), matching the static shell in dist/index.html.
 */
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => isFirebaseAuthEnabled());
  const subscribedRef = useRef(false);
  const unsubscribeRef = useRef<() => void>(() => {});

  const subscribe = useCallback((runtime: FirebaseRuntime) => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;
    if (!runtime.auth) {
      // If auth is not initialized, set loading to false and current user to null
      setCurrentUser(null);
      setLoading(false);
      return;
    }
    unsubscribeRef.current = runtime.onAuthStateChanged(runtime.auth, (user) => {
      setAuthSessionHint(Boolean(user));
      setCurrentUser(user);
      setLoading(false);
    });
  }, []);

  const ensureAuth = useCallback(async (): Promise<FirebaseRuntime> => {
    const runtime = await loadFirebase();
    subscribe(runtime);
    return runtime;
  }, [subscribe]);

  const loginWithGoogle = async () => {
    let runtime: FirebaseRuntime;
    try {
      runtime = await ensureAuth();
    } catch (error) {
      console.error('Firebase could not be loaded:', error);
      alert('Sign-in is unavailable right now. Please try again.');
      return;
    }
    if (!runtime.auth) {
      console.error("Firebase auth not initialized. Check VITE_FIREBASE_AUTH_ENABLED and Firebase configuration.");
      alert("Firebase authentication is not properly configured. Please check your Firebase configuration settings.");
      return;
    }

    const provider = new runtime.GoogleAuthProvider();
    try {
      await runtime.signInWithPopup(runtime.auth, provider);
    } catch (error) {
      console.error("Error during Google sign-in:", error);
      // Log additional details for debugging
      if (error instanceof Error) {
        console.error("Error details:", {
          code: (error as any).code,
          message: error.message,
          customData: (error as any).customData
        });

        // Show user-friendly error message
        if ((error as any).code === 'auth/configuration-not-found') {
          alert("Firebase authentication is not properly configured. Please ensure you have valid Firebase configuration values in your environment variables.");
        } else {
          alert(`Authentication error: ${error.message}`);
        }
      }
    }
  };

  const logout = async () => {
    let runtime: FirebaseRuntime;
    try {
      runtime = await ensureAuth();
    } catch (error) {
      console.error('Firebase could not be loaded:', error);
      return;
    }
    if (!runtime.auth) {
      console.error("Firebase auth not initialized");
      return;
    }

    try {
      await runtime.signOut(runtime.auth);
      setAuthSessionHint(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  useEffect(() => {
    if (!shouldRestoreAuthSession()) {
      setCurrentUser(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    loadFirebase().then((runtime) => {
      if (!cancelled) subscribe(runtime);
    }).catch((error) => {
      console.error('Firebase could not be loaded; continuing signed out:', error);
      if (cancelled) return;
      setCurrentUser(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribeRef.current();
      unsubscribeRef.current = () => {};
      subscribedRef.current = false;
    };
  }, [subscribe]);

  const value = {
    currentUser,
    loading,
    loginWithGoogle,
    logout,
  };

  // Children render immediately so the first frame matches the static shell;
  // consumers that act on the signed-in user wait for `loading` to clear.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
