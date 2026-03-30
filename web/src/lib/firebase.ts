import { initializeApp, getApps } from "firebase/app";
import { getAuth, getRedirectResult, GoogleAuthProvider, signInWithRedirect } from "firebase/auth";

export function isFirebaseConfigured(): boolean {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  return !!(apiKey && authDomain && projectId && appId);
}

export function getFirebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !appId) {
    // During Next.js build/prerender in environments without env vars,
    // don't hard-crash the build. Client pages should render a helpful prompt.
    return null;
  }

  return { apiKey, authDomain, projectId, appId };
}

export function firebaseApp() {
  if (getApps().length > 0) return getApps()[0]!;
  const cfg = getFirebaseConfig();
  if (!cfg) {
    throw new Error(
      "Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID"
    );
  }
  return initializeApp(cfg);
}

export function firebaseAuth() {
  return getAuth(firebaseApp());
}

export function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export async function beginGoogleRedirectSignIn() {
  await signInWithRedirect(firebaseAuth(), googleProvider());
}

export async function consumeGoogleRedirectResult() {
  return getRedirectResult(firebaseAuth());
}
