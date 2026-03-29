import "server-only";

import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function readRequiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getFirebaseProjectId() {
  return String(process.env.FIREBASE_PROJECT_ID ?? "").trim();
}

function parseJsonEnv(raw: string) {
  return JSON.parse(raw) as ServiceAccount;
}

function getFirebaseAdminServiceAccount(): ServiceAccount {
  const jsonB64 = String(process.env.FIREBASE_ADMIN_JSON_B64 ?? "").trim();
  if (jsonB64) {
    return parseJsonEnv(Buffer.from(jsonB64, "base64").toString("utf8"));
  }

  const json = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (json) {
    return parseJsonEnv(json);
  }

  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL ?? "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (clientEmail && privateKey) {
    return {
      projectId: getFirebaseProjectId(),
      clientEmail,
      privateKey,
    };
  }

  throw new Error("Firebase admin credentials are not configured");
}

function hasFirebaseAdminCredentials() {
  return Boolean(
    process.env.FIREBASE_ADMIN_JSON_B64
    || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
  );
}

function getFirebaseAdminApp() {
  if (getApps().length > 0) return getApps()[0]!;
  const serviceAccount = getFirebaseAdminServiceAccount();
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: getFirebaseProjectId() || serviceAccount.projectId,
  });
}

export type VerifiedFirebaseUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  picture: string | null;
};

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  if (!idToken) return null;

  try {
    if (hasFirebaseAdminCredentials()) {
      const auth = getAuth(getFirebaseAdminApp());
      const decoded = await auth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        displayName: typeof decoded.name === "string" ? decoded.name : null,
        picture: typeof decoded.picture === "string" ? decoded.picture : null,
      };
    }

    const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "").trim();
    if (!apiKey) return null;

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    const json = await response.json() as {
      users?: Array<{
        localId?: string;
        email?: string;
        displayName?: string;
        photoUrl?: string;
      }>;
    };
    const user = json.users?.[0];
    if (!user?.localId) {
      return null;
    }

    return {
      uid: user.localId,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      picture: user.photoUrl ?? null,
    };
  } catch {
    return null;
  }
}

export function readFirebaseApiKey() {
  return readRequiredEnv("NEXT_PUBLIC_FIREBASE_API_KEY");
}
