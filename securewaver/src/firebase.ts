import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

export type FirebaseInitResult = {
  auth: ReturnType<typeof getAuth>;
  googleProvider: GoogleAuthProvider;
};

let cached: FirebaseInitResult | null = null;

// Firebase web config values are not secrets.
// Provide them via Vite env vars.
export function initFirebase(): FirebaseInitResult {
  if (cached) return cached;

  const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
  const authDomain = String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();

  if (!apiKey || !authDomain || !projectId) {
    throw new Error(
      'Missing Firebase config. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID.'
    );
  }

  const firebaseConfig = { apiKey, authDomain, projectId };
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();

  cached = { auth, googleProvider };
  return cached;
}
