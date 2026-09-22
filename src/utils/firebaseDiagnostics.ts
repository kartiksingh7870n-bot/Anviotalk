import { doc, getDocFromServer, collection, getDocs, limit, query } from "firebase/firestore";
import { ref, getMetadata } from "firebase/storage";
import { auth, db, storage, firebaseConfig } from "../firebase";

export interface DiagnosticCheckResult {
  id: string;
  title: string;
  service: "config" | "auth" | "firestore" | "storage" | "analytics";
  status: "success" | "error" | "warning" | "pending";
  summary: string;
  details?: string;
  missingRequirement?: string;
  whyRequired?: string;
  fixSteps?: string[];
  generatedArtifacts?: {
    type: "rules" | "schema" | "env" | "indexes";
    title: string;
    code: string;
  }[];
}

export interface FirebaseHealthReport {
  isFullyConnected: boolean;
  projectId: string;
  checks: DiagnosticCheckResult[];
  criticalErrors: DiagnosticCheckResult[];
}

export async function runFirebaseDiagnostics(): Promise<FirebaseHealthReport> {
  const checks: DiagnosticCheckResult[] = [];
  const pId = firebaseConfig.projectId || "anvio-talk";

  // 1. Config & Environment Variable Check
  const missingEnvVars: string[] = [];
  if (!firebaseConfig.apiKey) {
    missingEnvVars.push("VITE_FIREBASE_API_KEY");
  }
  if (!firebaseConfig.projectId) missingEnvVars.push("VITE_FIREBASE_PROJECT_ID");
  
  if (missingEnvVars.length > 0) {
    checks.push({
      id: "env_check",
      title: "Firebase Environment Configuration",
      service: "config",
      status: "error",
      summary: `Missing or default environment variables: ${missingEnvVars.join(", ")}`,
      missingRequirement: `Missing Environment Variable(s): ${missingEnvVars.join(", ")}`,
      whyRequired: "Firebase SDK requires valid credentials to authenticate requests to Google Cloud services.",
      fixSteps: [
        "Open your project Settings > Environment Variables in AI Studio.",
        "Add the missing variable names with values from your Firebase Console (Project Settings > General > Web app config).",
        "Restart the application server."
      ],
      generatedArtifacts: [
        {
          type: "env",
          title: ".env.example",
          code: `VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=${pId}.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=${pId}
VITE_FIREBASE_STORAGE_BUCKET=${pId}.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1059844371114
VITE_FIREBASE_APP_ID=1:1059844371114:web:0ab0d9be1f9327274216d3`
        }
      ]
    });
  } else {
    checks.push({
      id: "env_check",
      title: "Firebase Environment Configuration",
      service: "config",
      status: "success",
      summary: `Project ID: ${pId} configured cleanly.`
    });
  }

  // 2. Auth Service Initialization Check
  if (auth) {
    checks.push({
      id: "auth_check",
      title: "Firebase Authentication",
      service: "auth",
      status: "success",
      summary: `Firebase Auth initialized. Active domain: ${firebaseConfig.authDomain}`
    });
  } else {
    checks.push({
      id: "auth_check",
      title: "Firebase Authentication",
      service: "auth",
      status: "error",
      summary: "Firebase Auth SDK failed to initialize.",
      missingRequirement: "Firebase Authentication provider not enabled or SDK error.",
      whyRequired: "User login, signup, Google OAuth, and secure profile management depend on Firebase Auth.",
      fixSteps: [
        "Go to Firebase Console > Authentication.",
        "Click 'Get Started' and enable Google Sign-In and Email/Password providers.",
        "In Authentication > Settings > Authorized Domains, add your current domain."
      ]
    });
  }

  // 3. Firestore Database Connection Check
  try {
    // Perform standard collection query test to verify Firestore availability
    await getDocs(query(collection(db, "users"), limit(1)));
    checks.push({
      id: "firestore_check",
      title: "Cloud Firestore Database",
      service: "firestore",
      status: "success",
      summary: "Cloud Firestore is online and responding."
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn("[Firebase Diagnostics] Firestore check error:", msg);

    if (msg.includes("database") && (msg.includes("does not exist") || msg.includes("not-found"))) {
      checks.push({
        id: "firestore_check",
        title: "Cloud Firestore Database",
        service: "firestore",
        status: "error",
        summary: `Default Firestore database does not exist in Google Cloud project '${pId}'.`,
        missingRequirement: `Firestore Database has not been created for Firebase project '${pId}'.`,
        whyRequired: "Anvio Talk stores user profiles, stories, chat threads, matches, and notifications in Cloud Firestore. Without a created database instance, data cannot be read or saved.",
        fixSteps: [
          `Open Firebase Console at https://console.firebase.google.com/project/${pId}/firestore`,
          "Click 'Create Database'.",
          "Select 'Start in production mode' (or test mode) and choose your preferred database location (e.g. us-central1 or asia-east1).",
          "Click 'Create' to provision the (default) Cloud Firestore database."
        ],
        generatedArtifacts: [
          {
            type: "schema",
            title: "Required Firestore Collections & Documents Schema",
            code: `// Collections Required for Anvio Talk:
1. /users/{userId}
   - uid (string)
   - username (string)
   - displayName (string)
   - email (string)
   - bio (string)
   - avatarUrl (string)
   - portfolioPhotos (array)
   - createdAt (timestamp)

2. /usernames/{username}
   - uid (string)

3. /stories/{storyId}
   - authorUid (string)
   - mediaUrl (string)
   - caption (string)
   - createdAt (timestamp)

4. /chats/{chatId}
   - participants (array of uids)
   - lastMessage (string)
   - lastUpdated (timestamp)
   
5. /chats/{chatId}/messages/{messageId}
   - senderId (string)
   - text (string)
   - createdAt (timestamp)`
          },
          {
            type: "rules",
            title: "firestore.rules",
            code: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }

    match /users/{userId} {
      allow read: if true;
      allow create, update: if isAuthenticated() && request.auth.uid == userId;
      allow delete: if false;
    }

    match /usernames/{username} {
      allow read: if true;
      allow create, update: if isAuthenticated();
    }

    match /stories/{storyId} {
      allow read: if true;
      allow create: if isAuthenticated() && request.resource.data.authorUid == request.auth.uid;
      allow update, delete: if isAuthenticated() && resource.data.authorUid == request.auth.uid;
    }

    match /chats/{chatId} {
      allow read, update, delete: if isAuthenticated() && request.auth.uid in resource.data.participants;
      allow create: if isAuthenticated();

      match /messages/{messageId} {
        allow read, create: if isAuthenticated();
      }
    }

    match /notifications/{userId}/items/{itemId} {
      allow read, write: if isAuthenticated() && request.auth.uid == userId;
    }
  }
}`
          }
        ]
      });
    } else if (msg.includes("permission-denied") || msg.includes("insufficient permissions")) {
      checks.push({
        id: "firestore_check",
        title: "Cloud Firestore Database",
        service: "firestore",
        status: "error",
        summary: "Firestore access denied by Security Rules.",
        missingRequirement: "Firestore Security Rules are blocking access.",
        whyRequired: "Firestore rules control read and write access. If rules deny permission, the application cannot fetch feed items or save updates.",
        fixSteps: [
          `Open https://console.firebase.google.com/project/${pId}/firestore/rules`,
          "Replace existing rules with the updated security rules for Anvio Talk.",
          "Click 'Publish'."
        ],
        generatedArtifacts: [
          {
            type: "rules",
            title: "firestore.rules",
            code: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`
          }
        ]
      });
    } else {
      // Mark other unknown errors as specific Firestore errors to trigger the diagnostic screen
      checks.push({
        id: "firestore_check",
        title: "Cloud Firestore Database",
        service: "firestore",
        status: "error",
        summary: "Cloud Firestore connection failed.",
        details: msg,
        missingRequirement: "Database connection or permission issue.",
        whyRequired: "Anvio Talk requires a working Firestore connection to load content.",
        fixSteps: [
          "Check your internet connection.",
          "Verify that your Firebase project has Firestore enabled.",
          "Check if your IP address is allowed if using VPC/Firewall rules."
        ]
      });
    }
  }

  // 4. Firebase Storage Check
  if (storage && storage.app) {
    checks.push({
      id: "storage_check",
      title: "Firebase Storage",
      service: "storage",
      status: "success",
      summary: `Firebase Storage bucket '${firebaseConfig.storageBucket}' is configured.`
    });
  } else {
    checks.push({
      id: "storage_check",
      title: "Firebase Storage",
      service: "storage",
      status: "error",
      summary: "Firebase Storage failed to initialize.",
      missingRequirement: "Firebase Storage SDK initialization error.",
      whyRequired: "Uploading profile photos, portfolio images, and story media requires Firebase Storage.",
      fixSteps: [
        `Open Firebase Console at https://console.firebase.google.com/project/${pId}/storage`,
        "Click 'Get Started'.",
        "Select default security rules and location, then click 'Done'."
      ]
    });
  }

  const criticalErrors = checks.filter((c) => c.status === "error");
  return {
    isFullyConnected: criticalErrors.length === 0,
    projectId: pId,
    checks,
    criticalErrors
  };
}
