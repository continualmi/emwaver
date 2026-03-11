import { initializeApp, cert, getApps, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import { env } from "./env";

export type VerifiedIdentity = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
};

function firebaseServiceAccount(): ServiceAccount | null {
  const rawB64 = (process.env.FIREBASE_ADMIN_JSON_B64 || "").trim();
  if (rawB64) {
    return JSON.parse(Buffer.from(rawB64, "base64").toString("utf8")) as ServiceAccount;
  }

  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson) {
    return JSON.parse(rawJson) as ServiceAccount;
  }

  return null;
}

export function getFirebaseAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const serviceAccount = firebaseServiceAccount();
  if (!serviceAccount) {
    throw new Error("Firebase Admin credentials are not configured");
  }
  return initializeApp({ credential: cert(serviceAccount), projectId: env.firebaseProjectId || serviceAccount.projectId });
}

export function bearerToken(headers: Headers): string | null {
  const raw = (headers.get("authorization") || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice("bearer ".length).trim();
  return token || null;
}

export async function verifyIdToken(token: string): Promise<VerifiedIdentity | null> {
  if (!token || !env.firebaseProjectId) return null;

  try {
    const app = getFirebaseAdminApp();
    const decoded = await getAuth(app).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: (decoded.name as string | undefined) ?? null,
    };
  } catch (error) {
    if (env.authDebug) {
      console.warn("firebase token verification failed", error);
    }
    return null;
  }
}
