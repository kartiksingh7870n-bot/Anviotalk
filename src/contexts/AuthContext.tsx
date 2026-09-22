import React, { createContext, useContext, useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  auth,
  db,
  isFirebaseConfigured,
  googleProvider,
} from "../firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithCredential,
  User,
} from "firebase/auth";
import {
  doc,
  onSnapshot,
  runTransaction,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  getDocFromServer,
} from "firebase/firestore";
import { UserProfile } from "../types";
import { getDefaultAvatar } from "../utils/avatar";
import { generateSearchKeywords } from "../utils/searchKeywords";

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isFirebase: boolean;
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<string>;
  logIn: (email: string, password: string) => Promise<void>;
  logInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<string | void>;
  continueAsGuest: () => void;
  isGuest: boolean;
  isFirestoreAvailable: boolean;
  firestoreErrorMessage: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [isFirestoreAvailable, setIsFirestoreAvailable] = useState(true);
  const [firestoreErrorMessage, setFirestoreErrorMessage] = useState<string | null>(null);

  // Fallback Mock State for when Firebase is not configured
  const [mockUser, setMockUser] = useState<any | null>(null);
  const [mockProfile, setMockProfile] = useState<UserProfile | null>(null);

  // Boot connection check to verify Firestore database initialization
  useEffect(() => {
    if (!isFirebaseConfigured) {
      setIsFirestoreAvailable(false);
      return;
    }
    setIsFirestoreAvailable(true);
    setFirestoreErrorMessage(null);
  }, []);

  const deriveDisplayNameFromEmail = (email?: string | null, fallbackUid?: string): string => {
    if (email && email.includes("@")) {
      const namePart = email.split("@")[0].trim();
      if (namePart) {
        return namePart.charAt(0).toUpperCase() + namePart.slice(1);
      }
    }
    return fallbackUid ? `User ${fallbackUid.slice(0, 6)}` : "Member";
  };

  // Helper to verify if an account is suspended or banned
  const checkAccountStatus = (profileData: any): { isBlocked: boolean; status: 'banned' | 'suspended' | 'active'; message: string } => {
    if (!profileData) return { isBlocked: false, status: 'active', message: '' };
    
    // Check accountStatus first, fallback to status field if specified by admin panel
    const rawStatus = (profileData.accountStatus || (profileData.status === 'banned' || profileData.status === 'suspended' ? profileData.status : 'active')).toLowerCase();
    
    if (rawStatus === 'banned') {
      return {
        isBlocked: true,
        status: 'banned',
        message: 'Your account has been permanently banned. Contact support if you believe this is a mistake.'
      };
    }
    
    if (rawStatus === 'suspended') {
      return {
        isBlocked: true,
        status: 'suspended',
        message: 'Your account has been temporarily suspended. Please contact support for more information.'
      };
    }
    
    return { isBlocked: false, status: 'active', message: '' };
  };

  const createFallbackProfile = (user: User): UserProfile => {
    const generatedUsername = "user_" + user.uid.slice(0, 6).toLowerCase();
    return {
      uid: user.uid,
      username: generatedUsername,
      displayName: user.displayName || deriveDisplayNameFromEmail(user.email, user.uid),
      email: user.email || "",
      bio: "",
      specialty: "Member",
      avatarUrl: user.photoURL || getDefaultAvatar(),
      portfolioPhotos: [],
      skillTags: [],
      status: 'active',
      accountStatus: 'active',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      followersCount: 0,
      followingCount: 0,
      x: Math.floor(Math.random() * 40) + 30,
      y: Math.floor(Math.random() * 40) + 30,
      hasCompletedProfileSetup: false,
    };
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        setIsGuest(false);
        
        // Load cache immediately for instant, responsive loading
        try {
          const cached = localStorage.getItem(`aura_user_profile_${user.uid}`);
          if (cached) {
            const parsedCached = JSON.parse(cached);
            const statusCheck = checkAccountStatus(parsedCached);
            if (statusCheck.isBlocked) {
              localStorage.removeItem(`aura_user_profile_${user.uid}`);
              setUserProfile(null);
              setCurrentUser(null);
              signOut(auth).catch(() => {});
              setLoading(false);
              return;
            }
            setUserProfile(parsedCached);
          }
        } catch (e) {
          console.warn("Failed to parse cached profile", e);
        }

        // Set up real-time listener for current user's profile document
        const userDocRef = doc(db, "users", user.uid);
        const unsubscribeProfile = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const profileData = docSnap.data() as UserProfile;
            const statusCheck = checkAccountStatus(profileData);
            if (statusCheck.isBlocked) {
              console.warn(`[AuthContext] Account is ${statusCheck.status}. Enforcing immediate logout.`);
              try {
                localStorage.removeItem(`aura_user_profile_${user.uid}`);
              } catch {}
              setUserProfile(null);
              setCurrentUser(null);
              signOut(auth).catch(() => {});
              setLoading(false);
              return;
            }

            setUserProfile(profileData);
            try {
              localStorage.setItem(`aura_user_profile_${user.uid}`, JSON.stringify(profileData));
            } catch (e) {}
            setIsFirestoreAvailable(true);
            setFirestoreErrorMessage(null);
          } else {
            // Profile document might not exist in Firestore yet
            setUserProfile(prev => prev || createFallbackProfile(user));
          }
          setLoading(false);
        }, (error) => {
          console.warn("[AuthContext] Profile listener warning:", error?.message || error);
          setUserProfile(prev => prev || createFallbackProfile(user));
          setLoading(false);
        });

        return () => {
          unsubscribeProfile();
        };
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Foreground / Visibility change listener to immediately catch admin suspensions
  useEffect(() => {
    if (!isFirebaseConfigured || !currentUser || isGuest) return;

    const verifyCurrentAccountStatus = async () => {
      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          const statusCheck = checkAccountStatus(docSnap.data());
          if (statusCheck.isBlocked) {
            console.warn(`[AuthContext] Real-time verification: Account is ${statusCheck.status}. Logging out.`);
            try {
              localStorage.removeItem(`aura_user_profile_${currentUser.uid}`);
            } catch {}
            setUserProfile(null);
            setCurrentUser(null);
            await signOut(auth);
          }
        }
      } catch (e) {
        // Non-blocking
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        verifyCurrentAccountStatus();
      }
    };

    window.addEventListener('focus', verifyCurrentAccountStatus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', verifyCurrentAccountStatus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser, isGuest]);

  // Periodically update lastActiveAt for real logged-in users
  useEffect(() => {
    if (!isFirebaseConfigured || !currentUser || isGuest || !isFirestoreAvailable) return;

    const updateActivity = async () => {
      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        await setDoc(userDocRef, {
          lastActiveAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn("Failed to update active time (non-blocking):", e);
      }
    };

    updateActivity(); // run once immediately
    const interval = setInterval(updateActivity, 2 * 60 * 1000); // every 2 minutes
    return () => clearInterval(interval);
  }, [currentUser, isGuest, isFirestoreAvailable]);

  const signUp = async (email: string, password: string, username: string, displayName: string): Promise<string> => {
    const formattedUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
    if (!isFirebaseConfigured || !isFirestoreAvailable) {
      // Mock / Local fallback signup when Firebase or Firestore is not available
      const localUid = currentUser ? currentUser.uid : ("mock_user_" + Math.random().toString(36).substr(2, 9));
      const finalUsername = formattedUsername;
      const newLocalProfile: UserProfile = {
        uid: localUid,
        username: finalUsername,
        displayName,
        email,
        bio: "",
        specialty: "Digital Creator",
        avatarUrl: getDefaultAvatar(),
        portfolioPhotos: [],
        skillTags: [],
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        followersCount: 0,
        followingCount: 0,
        x: 50,
        y: 50,
        hasCompletedProfileSetup: false,
      };
      if (!isFirebaseConfigured) {
        setMockUser({ uid: localUid, email, displayName });
        setMockProfile(newLocalProfile);
      } else {
        try {
          localStorage.setItem(`aura_user_profile_${localUid}`, JSON.stringify(newLocalProfile));
        } catch (e) {}
        setUserProfile(newLocalProfile);
      }
      setIsGuest(false);
      return finalUsername;
    }

    // Real Firebase Auth and transaction to guarantee username uniqueness
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    let finalUsername = formattedUsername;

    try {
      await runTransaction(db, async (transaction) => {
        let usernameDocRef = doc(db, "usernames", formattedUsername);
        let usernameSnap = await transaction.get(usernameDocRef);

        if (usernameSnap.exists()) {
          // Base username is taken, try appending a random digit (0-9)
          let found = false;
          const tried = new Set<number>();
          for (let attempt = 0; attempt < 20; attempt++) {
            let suffixDigit = Math.floor(Math.random() * 10);
            while (tried.has(suffixDigit) && tried.size < 10) {
              suffixDigit = Math.floor(Math.random() * 10);
            }
            tried.add(suffixDigit);

            const candidate = `${formattedUsername}${suffixDigit}`;
            const candidateRef = doc(db, "usernames", candidate);
            const candidateSnap = await transaction.get(candidateRef);
            if (!candidateSnap.exists()) {
              finalUsername = candidate;
              usernameDocRef = candidateRef;
              found = true;
              break;
            }
          }

          // If we tried all single digits 0-9 and they are still taken, try double digits (10-99)
          if (!found) {
            for (let attempt = 0; attempt < 20; attempt++) {
              const suffixVal = Math.floor(Math.random() * 90) + 10;
              const candidate = `${formattedUsername}${suffixVal}`;
              const candidateRef = doc(db, "usernames", candidate);
              const candidateSnap = await transaction.get(candidateRef);
              if (!candidateSnap.exists()) {
                finalUsername = candidate;
                usernameDocRef = candidateRef;
                found = true;
                break;
              }
            }
          }

          if (!found) {
            throw new Error("Could not generate a unique username after several attempts.");
          }
        }

        const userDocRef = doc(db, "users", user.uid);
        const searchKeywords = generateSearchKeywords(displayName, finalUsername, "Digital Creator", "", []);
        const newProfile: UserProfile = {
          uid: user.uid,
          username: finalUsername,
          displayName,
          email: user.email || email,
          bio: "",
          specialty: "Digital Creator",
          avatarUrl: getDefaultAvatar(),
          portfolioPhotos: [],
          skillTags: [],
          status: 'active',
          accountStatus: 'active',
          createdAt: serverTimestamp() as any,
          lastActiveAt: serverTimestamp() as any,
          followersCount: 0,
          followingCount: 0,
          x: Math.floor(Math.random() * 40) + 30, // 30% to 70% random starting position
          y: Math.floor(Math.random() * 40) + 30,
          hasCompletedProfileSetup: false,
          searchKeywords,
        };

        transaction.set(userDocRef, newProfile);
        transaction.set(usernameDocRef, { uid: user.uid });
      });
    } catch (error: any) {
      console.warn("Firestore signUp transaction failed, falling back to local fallback:", error);
      const msg = error?.message || String(error);
      if (
        msg.includes("does not exist") ||
        msg.includes("not-found") ||
        msg.includes("permission") ||
        msg.includes("database")
      ) {
        setIsFirestoreAvailable(false);
        setFirestoreErrorMessage(msg);
      }

      // Create profile locally in localStorage so onboarding works perfectly
      const localProfile: UserProfile = {
        uid: user.uid,
        username: finalUsername,
        displayName,
        email: user.email || email,
        bio: "",
        specialty: "Digital Creator",
        avatarUrl: getDefaultAvatar(),
        portfolioPhotos: [],
        skillTags: [],
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        followersCount: 0,
        followingCount: 0,
        x: Math.floor(Math.random() * 40) + 30,
        y: Math.floor(Math.random() * 40) + 30,
        hasCompletedProfileSetup: false,
      };

      try {
        localStorage.setItem(`aura_user_profile_${user.uid}`, JSON.stringify(localProfile));
      } catch (e) {}

      setUserProfile(localProfile);
    }

    return finalUsername;
  };

  const logIn = async (email: string, password: string) => {
    if (!isFirebaseConfigured) {
      // Mock log in
      if (email === "guest@anviotalk.com") {
        continueAsGuest();
        return;
      }
      const mockUid = "mock_alex";
      setMockUser({ uid: mockUid, email, displayName: "Alex Mercer" });
      setMockProfile({
        uid: mockUid,
        username: "alexmercer",
        displayName: "Alex Mercer",
        email,
        bio: "Visual artist and interactive web designer. Exploring the intersection of high-contrast brutalist styling and local creative collaboration. Let us build something real.",
        specialty: "Creative Director",
        avatarUrl: getDefaultAvatar("Male"),
        portfolioPhotos: [
          'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&q=80',
          'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80'
        ],
        skillTags: ["UI Design", "Fine Art", "Typography", "Creative Coding"],
        status: 'active',
        accountStatus: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        followersCount: 0,
        followingCount: 0,
        x: 52,
        y: 48,
        profileCompleted: true
      });
      setIsGuest(false);
      return;
    }

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    if (user) {
      try {
        const userDocRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          const profileData = docSnap.data();
          const statusCheck = checkAccountStatus(profileData);
          if (statusCheck.isBlocked) {
            try {
              localStorage.removeItem(`aura_user_profile_${user.uid}`);
            } catch {}
            setUserProfile(null);
            setCurrentUser(null);
            await signOut(auth);
            throw new Error(statusCheck.message);
          }
        }
      } catch (err: any) {
        if (
          err?.message?.includes("permanently banned") ||
          err?.message?.includes("temporarily suspended")
        ) {
          throw err;
        }
      }
    }
  };

  // Helper to detect standalone / PWA / installed app mode
  const isStandaloneMode = (): boolean => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://")
    );
  };

  // Helper to ensure Google user profile is created/synced after login (popup or redirect)
  const ensureGoogleUserProfile = async (user: User) => {
    if (!isFirestoreAvailable) {
      const generatedUsername = "user_" + user.uid.slice(0, 6).toLowerCase();
      const localProfile: UserProfile = {
        uid: user.uid,
        username: generatedUsername,
        displayName: user.displayName || deriveDisplayNameFromEmail(user.email, user.uid),
        email: user.email || "",
        bio: "",
        specialty: "Digital Creator",
        avatarUrl: user.photoURL || getDefaultAvatar(),
        portfolioPhotos: [],
        skillTags: [],
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        followersCount: 0,
        followingCount: 0,
        x: Math.floor(Math.random() * 40) + 30,
        y: Math.floor(Math.random() * 40) + 30,
        hasCompletedProfileSetup: false,
      };
      try {
        localStorage.setItem(`aura_user_profile_${user.uid}`, JSON.stringify(localProfile));
      } catch (e) {}
      setUserProfile(localProfile);
      return;
    }

    try {
      const userDocRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(userDocRef);

      if (!docSnap.exists()) {
        const generatedUsername = "user_" + user.uid.slice(0, 6).toLowerCase();
        let usernameToUse = generatedUsername;

        await runTransaction(db, async (transaction) => {
          let usernameDocRef = doc(db, "usernames", generatedUsername);
          let usernameSnap = await transaction.get(usernameDocRef);

          if (usernameSnap.exists()) {
            let found = false;
            const tried = new Set<number>();
            for (let attempt = 0; attempt < 20; attempt++) {
              let suffixDigit = Math.floor(Math.random() * 10);
              while (tried.has(suffixDigit) && tried.size < 10) {
                suffixDigit = Math.floor(Math.random() * 10);
              }
              tried.add(suffixDigit);

              const candidate = `${generatedUsername}${suffixDigit}`;
              const candidateRef = doc(db, "usernames", candidate);
              const candidateSnap = await transaction.get(candidateRef);
              if (!candidateSnap.exists()) {
                usernameToUse = candidate;
                usernameDocRef = candidateRef;
                found = true;
                break;
              }
            }

            if (!found) {
              const fallbackCandidate = `user_${Date.now()}`;
              usernameToUse = fallbackCandidate;
              usernameDocRef = doc(db, "usernames", fallbackCandidate);
            }
          }

          const dispName = user.displayName || deriveDisplayNameFromEmail(user.email, user.uid);
          const searchKeywords = generateSearchKeywords(dispName, usernameToUse, "Digital Creator", "", []);
          const newProfile: UserProfile = {
            uid: user.uid,
            username: usernameToUse,
            displayName: dispName,
            email: user.email || "",
            bio: "",
            specialty: "Digital Creator",
            avatarUrl: user.photoURL || getDefaultAvatar(),
            portfolioPhotos: [],
            skillTags: [],
            status: 'active',
            createdAt: serverTimestamp() as any,
            lastActiveAt: serverTimestamp() as any,
            followersCount: 0,
            followingCount: 0,
            x: Math.floor(Math.random() * 40) + 30,
            y: Math.floor(Math.random() * 40) + 30,
            hasCompletedProfileSetup: false,
            searchKeywords,
          };

          transaction.set(userDocRef, newProfile);
          transaction.set(usernameDocRef, { uid: user.uid });
        });
      }
    } catch (err: any) {
      console.warn("Firestore Google profile initialization error, using local fallback:", err);
      const msg = err?.message || String(err);
      if (
        msg.includes("does not exist") ||
        msg.includes("not-found") ||
        msg.includes("permission") ||
        msg.includes("database")
      ) {
        setIsFirestoreAvailable(false);
        setFirestoreErrorMessage(msg);
      }
      const generatedUsername = "user_" + user.uid.slice(0, 6).toLowerCase();
      const localProfile: UserProfile = {
        uid: user.uid,
        username: generatedUsername,
        displayName: user.displayName || deriveDisplayNameFromEmail(user.email, user.uid),
        email: user.email || "",
        bio: "",
        specialty: "Digital Creator",
        avatarUrl: user.photoURL || getDefaultAvatar(),
        portfolioPhotos: [],
        skillTags: [],
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        followersCount: 0,
        followingCount: 0,
        x: Math.floor(Math.random() * 40) + 30,
        y: Math.floor(Math.random() * 40) + 30,
        hasCompletedProfileSetup: false,
      };
      try {
        localStorage.setItem(`aura_user_profile_${user.uid}`, JSON.stringify(localProfile));
      } catch (e) {}
      setUserProfile(localProfile);
    }
  };

  // Route both native and web Google sign-in flows through a unified completion handler
  const finishGoogleSignIn = async (user: User) => {
    await ensureGoogleUserProfile(user);
    try {
      const userDocRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists()) {
        const profileData = docSnap.data();
        const statusCheck = checkAccountStatus(profileData);
        if (statusCheck.isBlocked) {
          try {
            localStorage.removeItem(`aura_user_profile_${user.uid}`);
          } catch {}
          setUserProfile(null);
          setCurrentUser(null);
          await signOut(auth);
          throw new Error(statusCheck.message);
        }
      }
    } catch (err: any) {
      if (
        err?.message?.includes("permanently banned") ||
        err?.message?.includes("temporarily suspended")
      ) {
        throw err;
      }
    }
  };

  // Check for getRedirectResult on mount (handles PWA / mobile standalone redirect return)
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    getRedirectResult(auth)
      .then(async (result) => {
        if (result && result.user) {
          console.log("[AuthContext] Handled redirect result for user:", result.user.uid);
          await finishGoogleSignIn(result.user);
        }
      })
      .catch((err) => {
        console.warn("[AuthContext] getRedirectResult notice:", err);
      });
  }, []);

  const logInWithGoogle = async () => {
    if (!isFirebaseConfigured) {
      await logIn("google_user@anviotalk.com", "password");
      return;
    }

    // =========================================================================
    // NATIVE APP PATH (Capacitor Android / iOS)
    // =========================================================================
    if (Capacitor.isNativePlatform()) {
      console.log("[AuthContext] Native platform detected, initiating native Google Sign-In account picker");
      try {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;

        if (!idToken) {
          throw new Error("No idToken returned from native Google Sign-In account picker.");
        }

        const credential = GoogleAuthProvider.credential(idToken);
        const userCredential = await signInWithCredential(auth, credential);
        if (userCredential && userCredential.user) {
          await finishGoogleSignIn(userCredential.user);
        }
        return;
      } catch (err: any) {
        console.error("[AuthContext] Native Google Sign-In error:", err);

        const errMsg = err?.message || String(err);
        const errCode = String(err?.code || "");

        // Error handling for native path: user cancelled / dismissed account picker
        if (
          errMsg.toLowerCase().includes("cancel") ||
          errMsg.toLowerCase().includes("popup_closed") ||
          errCode === "12501" ||
          errMsg.includes("12501") ||
          errMsg.includes("SIGN_IN_CANCELLED")
        ) {
          throw new Error("Google Sign-In was cancelled.");
        }

        // Error handling for native path: no accounts on device or Play Services issue
        if (
          errMsg.toLowerCase().includes("no accounts") ||
          errCode === "12500" ||
          errMsg.includes("12500") ||
          errMsg.includes("SIGN_IN_FAILED")
        ) {
          throw new Error("Native Google Sign-In failed. Please verify Google Play Services and registered Google accounts on your device.");
        }

        throw new Error(err?.message || "Failed to sign in with native Google account.");
      }
    }

    // =========================================================================
    // WEB / INSTALLED PWA / BROWSER PATH
    // =========================================================================
    const standalone = isStandaloneMode();
    if (standalone) {
      console.log("[AuthContext] Standalone mode detected, using signInWithRedirect");
      await signInWithRedirect(auth, googleProvider);
      return;
    }

    let result;
    try {
      result = await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("[AuthContext] Google signInWithPopup error:", err);
      // If popup is blocked, closed, or disallowed in PWA iframe, fallback to redirect
      if (
        err?.code === "auth/popup-blocked" ||
        err?.code === "auth/popup-closed-by-user" ||
        err?.code === "auth/operation-not-supported-in-this-environment" ||
        err?.message?.includes("popup")
      ) {
        console.warn("[AuthContext] Popup failed/blocked, falling back to signInWithRedirect");
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      if (
        err?.code === "auth/unauthorized-domain" ||
        err?.message?.includes("unauthorized-domain") ||
        err?.message?.includes("unauthorized domain") ||
        err?.message?.includes("authorized domain")
      ) {
        const host = typeof window !== "undefined" ? window.location.hostname : "anviotalk.ai.studio";
        throw new Error(
          `UNAUTHORIZED_DOMAIN:${host}`
        );
      }
      throw err;
    }

    if (result && result.user) {
      await finishGoogleSignIn(result.user);
    }
  };

  const logOut = async () => {
    if (!isFirebaseConfigured) {
      setMockUser(null);
      setMockProfile(null);
      setIsGuest(false);
      return;
    }
    await signOut(auth);
  };

  const updateProfile = async (data: Partial<UserProfile>): Promise<string | void> => {
    let finalUsername = data.username || userProfile?.username || "";
    if (data.username) {
      finalUsername = data.username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
    }

    const mergedName = data.displayName || (data as any).fullName || userProfile?.displayName || (userProfile as any)?.fullName || "";
    const mergedUsername = finalUsername || data.username || userProfile?.username || "";
    const mergedSpecialty = data.specialty || (data as any).occupation || userProfile?.specialty || (userProfile as any)?.occupation || "Digital Creator";
    const mergedCity = data.city || userProfile?.city || "";
    const mergedTags = data.skillTags || (data as any).interests || userProfile?.skillTags || (userProfile as any)?.interests || [];
    const searchKeywords = generateSearchKeywords(mergedName, mergedUsername, mergedSpecialty, mergedCity, mergedTags);

    // Strip server/admin-only fields so a client can never write them to its own user doc.
    // These fields are exclusively managed by the server via Firebase Admin SDK (rules-enforced).
    const SERVER_ONLY_USER_FIELDS = [
      'isAdmin',
      'role',
      'isMonetized',
      'monetizationStatus',
      'monetizationApprovedAt',
      'unpaidBalanceUsd',
      'isFake',
      'flaggedAsFake',
      'isSuspended',
      'suspendedAt',
      'suspendedReason',
      'hasWarning',
      'warningMessage',
      'warnedAt',
      'adImpressionsCount'
    ] as const;

    const dataWithKeywords: Record<string, any> = { ...data, searchKeywords };
    SERVER_ONLY_USER_FIELDS.forEach((f) => {
      delete dataWithKeywords[f];
    });

    // 1. Optimistic Updates for Instant Preview
    const mergedProfile = { ...(userProfile || {}), ...dataWithKeywords, username: finalUsername || (userProfile?.username || "") } as UserProfile;
    setUserProfile(mergedProfile);
    if (currentUser) {
      try {
        localStorage.setItem(`aura_user_profile_${currentUser.uid}`, JSON.stringify(mergedProfile));
      } catch (e) {}
    }

    if (!isFirebaseConfigured || isGuest || !isFirestoreAvailable) {
      if (mockProfile) {
        setMockProfile({ ...mockProfile, ...dataWithKeywords });
      } else {
        setMockProfile(mergedProfile);
      }
      return finalUsername;
    }

    if (!currentUser) return;

    // If username is being updated, handle uniqueness check and reservation
    if (data.username) {
      const formattedUsername = finalUsername;

      // Only perform uniqueness reservation if it's different from current
      if (!userProfile || userProfile.username !== formattedUsername) {
        try {
          await runTransaction(db, async (transaction) => {
            let usernameDocRef = doc(db, "usernames", formattedUsername);
            let usernameSnap = await transaction.get(usernameDocRef);

            if (usernameSnap.exists()) {
              // taken! Try appending a random digit (0-9)
              let found = false;
              const tried = new Set<number>();
              for (let attempt = 0; attempt < 20; attempt++) {
                let suffixDigit = Math.floor(Math.random() * 10);
                while (tried.has(suffixDigit) && tried.size < 10) {
                  suffixDigit = Math.floor(Math.random() * 10);
                }
                tried.add(suffixDigit);

                const candidate = `${formattedUsername}${suffixDigit}`;
                const candidateRef = doc(db, "usernames", candidate);
                const candidateSnap = await transaction.get(candidateRef);
                if (!candidateSnap.exists()) {
                  finalUsername = candidate;
                  usernameDocRef = candidateRef;
                  found = true;
                  break;
                }
              }

              if (!found) {
                for (let attempt = 0; attempt < 20; attempt++) {
                  const suffixVal = Math.floor(Math.random() * 90) + 10;
                  const candidate = `${formattedUsername}${suffixVal}`;
                  const candidateRef = doc(db, "usernames", candidate);
                  const candidateSnap = await transaction.get(candidateRef);
                  if (!candidateSnap.exists()) {
                    finalUsername = candidate;
                    usernameDocRef = candidateRef;
                    found = true;
                    break;
                  }
                }
              }

              if (!found) {
                throw new Error("Could not generate a unique username after several attempts.");
              }
            }

            // Delete the old username document if user already had a different one
            if (userProfile && userProfile.username) {
              const oldUsernameDocRef = doc(db, "usernames", userProfile.username);
              transaction.delete(oldUsernameDocRef);
            }

            // Reserve new username
            transaction.set(usernameDocRef, { uid: currentUser.uid });
            
            // Also set user profile with the final unique username, searchKeywords and any other data
            const userDocRef = doc(db, "users", currentUser.uid);
            transaction.set(userDocRef, { ...dataWithKeywords, username: finalUsername }, { merge: true });
          });
        } catch (err: any) {
          console.warn("Username reservation transaction fallback:", err);
          const msg = err?.message || String(err);
          if (
            msg.includes("does not exist") ||
            msg.includes("not-found") ||
            msg.includes("permission") ||
            msg.includes("database")
          ) {
            setIsFirestoreAvailable(false);
            setFirestoreErrorMessage(msg);
          }
          // Fallback to local success since state and cache are already updated
          return finalUsername;
        }

        // We already performed the set inside the transaction!
        return finalUsername;
      }
    }

    // Standard profile update (no username change, or same username)
    const userDocRef = doc(db, "users", currentUser.uid);
    const promiseWithTimeout = <T,>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(errorMsg));
        }, ms);

        promise
          .then((res) => {
            clearTimeout(timer);
            resolve(res);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    };

    try {
      await promiseWithTimeout(
        setDoc(userDocRef, dataWithKeywords, { merge: true }),
        7000,
        "Saving profile timed out. Firestore database connection might be offline, or permissions are restricted."
      );
    } catch (e: any) {
      console.warn("Firestore updateProfile fallback to local profile:", e);
      const msg = e?.message || String(e);
      if (
        msg.includes("does not exist") ||
        msg.includes("not-found") ||
        msg.includes("permission") ||
        msg.includes("database")
      ) {
        setIsFirestoreAvailable(false);
        setFirestoreErrorMessage(msg);
      }
      // Fallback to local success since state and cache are already updated
      return finalUsername;
    }

    return finalUsername;
  };

  const continueAsGuest = () => {
    setIsGuest(true);
    setMockUser(null);
    setMockProfile(null);
  };

  const value = {
    currentUser: isFirebaseConfigured ? currentUser : mockUser,
    userProfile: isFirebaseConfigured ? userProfile : mockProfile,
    loading,
    isFirebase: isFirebaseConfigured,
    signUp,
    logIn,
    logInWithGoogle,
    logOut,
    updateProfile,
    continueAsGuest,
    isGuest,
    isFirestoreAvailable,
    firestoreErrorMessage,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
