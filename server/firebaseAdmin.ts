import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import fs from "fs";

let isConfiguredWithServiceAccount = false;

export function parseServiceAccountJson(rawValue: string): Record<string, any> | null {
  if (!rawValue || typeof rawValue !== "string") {
    return null;
  }

  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return null;
  }

  let parsed: any = null;

  // Attempt 1: Direct JSON parsing
  try {
    const directParsed = JSON.parse(trimmedValue);
    if (directParsed && typeof directParsed === "object" && !Array.isArray(directParsed)) {
      parsed = directParsed;
    }
  } catch {
    // Direct JSON parsing failed, try next methods
  }

  // Attempt 2: File path on disk (if user provided a local file path)
  if (!parsed) {
    try {
      if (fs.existsSync(trimmedValue)) {
        const fileContent = fs.readFileSync(trimmedValue, "utf-8").trim();
        const fileParsed = JSON.parse(fileContent);
        if (fileParsed && typeof fileParsed === "object" && !Array.isArray(fileParsed)) {
          parsed = fileParsed;
        }
      }
    } catch {
      // Ignore file check error
    }
  }

  // Attempt 3: Base64-decoded JSON parsing
  if (!parsed) {
    try {
      const decodedString = Buffer.from(trimmedValue, "base64").toString("utf-8").trim();
      if (decodedString.startsWith("{") && decodedString.endsWith("}")) {
        const base64Parsed = JSON.parse(decodedString);
        if (base64Parsed && typeof base64Parsed === "object" && !Array.isArray(base64Parsed)) {
          parsed = base64Parsed;
        }
      }
    } catch {
      // Base64 decode / parse failed
    }
  }

  // If successfully parsed, validate required service account fields
  if (parsed) {
    const requiredFields = ["project_id", "private_key", "client_email"];
    const missingFields = requiredFields.filter((field) => !parsed[field]);

    if (missingFields.length > 0) {
      console.error(
        `[FirebaseAdmin] ❌ Parsed service account JSON is missing required field(s): ${missingFields.join(", ")}. Please verify your service account key file.`
      );
      return null;
    }

    return parsed;
  }

  // If all parsing attempts failed, log detailed actionable guidance
  console.error(
    `[FirebaseAdmin] ❌ FIREBASE_SERVICE_ACCOUNT_JSON is set (${trimmedValue.length} characters received) but could not be parsed as valid JSON or Base64-encoded JSON.\n` +
    `  👉 Option A: Provide single-line minified JSON string:\n` +
    `     cat service-account.json | jq -c .\n` +
    `  👉 Option B: Provide Base64-encoded string:\n` +
    `     cat service-account.json | base64 | tr -d '\\n'\n` +
    `  ℹ️ Running with unauthenticated fallback. Admin operations requiring elevated privileges will be restricted.`
  );

  return null;
}

export function getFirebaseAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }

  let credential: any = null;
  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

  if (serviceAccountEnv) {
    try {
      const serviceAccount = parseServiceAccountJson(serviceAccountEnv);
      if (serviceAccount) {
        credential = cert(serviceAccount);
        isConfiguredWithServiceAccount = true;
        console.log(
          `[FirebaseAdmin] ✅ Successfully configured Firebase Admin SDK with service account credentials for project: ${serviceAccount.project_id || "anvio-talk"}`
        );
      }
    } catch (e: any) {
      console.warn("[FirebaseAdmin] Error applying credential to Firebase Admin SDK:", e?.message || e);
    }
  }

  if (!credential && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      isConfiguredWithServiceAccount = true;
      console.log("[FirebaseAdmin] Using GOOGLE_APPLICATION_CREDENTIALS environment variable.");
    } catch (e: any) {
      console.warn("[FirebaseAdmin] Warning: GOOGLE_APPLICATION_CREDENTIALS not loaded:", e?.message || e);
    }
  }

  if (credential) {
    return initializeApp({
      credential,
      projectId: "anvio-talk"
    });
  }

  console.log("[FirebaseAdmin] Running with projectId 'anvio-talk'. Set FIREBASE_SERVICE_ACCOUNT_JSON for privileged operations.");
  return initializeApp({
    projectId: "anvio-talk"
  });
}

// Initialize Admin App
export const adminApp = getFirebaseAdminApp();
export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
export const adminMessaging = getMessaging(adminApp);
export const isServiceAccountConfigured = isConfiguredWithServiceAccount;
export { FieldValue, Timestamp };
