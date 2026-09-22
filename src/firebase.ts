import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { 
  getAuth, 
  initializeAuth, 
  browserLocalPersistence, 
  browserPopupRedirectResolver, 
  indexedDBLocalPersistence, 
  inMemoryPersistence, 
  GoogleAuthProvider, 
  setPersistence,
  Auth 
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

export const firebaseConfig = {
  apiKey: "AIzaSyBR9e8eLDsyr5cHhwkcanRTbPqqjfGBBHU",
  authDomain: "anvio-talk.firebaseapp.com",
  projectId: "anvio-talk",
  storageBucket: "anvio-talk.firebasestorage.app",
  messagingSenderId: "1059844371114",
  appId: "1:1059844371114:web:0ab0d9be1f9327274216d3",
  measurementId: "G-YGJ3SFH5NK"
};

console.log("[firebase-init] Initializing Firebase exclusively with project:", firebaseConfig.projectId);

export const isFirebaseConfigured = true;

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Safe initialization of Firebase Auth with fallback to avoid "Component auth has not been registered yet"
function initFirebaseAuth(firebaseApp: FirebaseApp): Auth {
  try {
    if (typeof window !== "undefined") {
      try {
        return initializeAuth(firebaseApp, {
          persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
          popupRedirectResolver: browserPopupRedirectResolver,
        });
      } catch {
        return getAuth(firebaseApp);
      }
    } else {
      return getAuth(firebaseApp);
    }
  } catch {
    return getAuth(firebaseApp);
  }
}

const auth: Auth = initFirebaseAuth(app);

if (typeof window !== "undefined" && auth) {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn("[firebase-auth] Failed to set browserLocalPersistence:", err);
  });
}

const db = getFirestore(app);
const storage = getStorage(app);
let analytics: any = null;

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch((err) => {
    console.warn("Analytics not supported in this environment:", err);
  });
}

const googleProvider = new GoogleAuthProvider();

export { app, auth, db, storage, googleProvider, analytics };
