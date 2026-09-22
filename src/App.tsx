import { useState, useEffect, useRef, useCallback } from 'react';
import WelcomeScreen from './components/WelcomeScreen';
import LoginScreen from './components/LoginScreen';
import DiscoveryMap from './components/DiscoveryMap';
import ProfileSetupScreen from './components/ProfileSetupScreen';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Loader2, Lock } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import AdminPanelModal from './components/AdminPanelModal';
import SplashIntro from './components/SplashIntro';
import StandaloneSharedView from './components/StandaloneSharedView';
import { parseDeepLink, DeepLinkTarget } from './utils/deeplink';
import { motion } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { App as AppPlugin } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { FirebaseDiagnosticScreen } from './components/FirebaseDiagnosticScreen';
import { runFirebaseDiagnostics, FirebaseHealthReport } from './utils/firebaseDiagnostics';
import { LegalPolicyPage } from './components/LegalPolicyPage';
import { isPolicyPath, navigateToPolicyPath } from './utils/policyNavigation';

type ScreenType = 'welcome' | 'login' | 'profileSetup' | 'map';

const SharedLinkExplosion = ({ countdown }: { countdown: number }) => {
  const particles = Array.from({ length: 40 }).map((_, i) => ({
    id: i,
    x: Math.random() * 100 - 50,
    y: Math.random() * 100 - 50,
    scale: Math.random() * 1.5 + 0.5,
    delay: Math.random() * 0.5,
    color: ['#DDF639', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B'][i % 6]
  }));

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] z-[180] flex flex-col items-center justify-center p-6 text-center overflow-hidden font-sans select-none">
      <div className="absolute w-96 h-96 bg-[#DDF639]/10 rounded-full blur-[100px] animate-pulse" />

      <div className="relative z-10 flex flex-col items-center max-w-md">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
              animate={{ 
                x: p.x * 6, 
                y: p.y * 6, 
                opacity: [1, 0.8, 0], 
                scale: p.scale 
              }}
              transition={{ 
                duration: 2.2, 
                repeat: Infinity, 
                repeatType: "loop",
                delay: p.delay,
                ease: "easeOut"
              }}
              className="absolute w-3 h-3 rounded-full"
              style={{ backgroundColor: p.color }}
            />
          ))}
        </div>

        <motion.div 
          key={countdown}
          initial={{ scale: 0.2, rotate: -45, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 10 }}
          className="w-32 h-32 bg-[#1E1E1E] border border-[#2A2A2A] rounded-full flex items-center justify-center text-[#DDF639] text-5xl font-black shadow-2xl mb-8 relative"
        >
          {countdown}
          <div className="absolute -inset-2 border-2 border-dashed border-[#DDF639]/40 rounded-full animate-spin [animation-duration:8s]" />
        </motion.div>

        <h2 className="text-2xl font-black text-white tracking-tight mb-3">
          💥 DECRYPTING CONNECTION LINK 💥
        </h2>
        <p className="text-sm text-[#DDF639] font-bold uppercase tracking-widest mb-6">
          Preparing Spatial Audio Salon...
        </p>
        
        <div className="w-full bg-[#1E1E1E] h-1.5 rounded-full overflow-hidden mb-4 border border-[#2A2A2A] p-[1px]">
          <motion.div 
            initial={{ width: '0%' }}
            animate={{ width: `${(5 - countdown) * 20}%` }}
            transition={{ duration: 0.8 }}
            className="h-full bg-[#DDF639] rounded-full"
          />
        </div>

        <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
          Syncing cryptographic coordinates with <strong>Anvio Talk</strong> server. Stand by for instant creative teleportation.
        </p>
      </div>
    </div>
  );
};

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [activeScreen, setActiveScreen] = useState<ScreenType>('welcome');
  const [currentSlide, setCurrentSlide] = useState(0);

  // Shared deep link target state
  const [deepLinkTarget, setDeepLinkTarget] = useState<DeepLinkTarget | null>(() => {
    return parseDeepLink(window.location.pathname, window.location.search);
  });

  // Shared link explosion states
  const [showExplosion, setShowExplosion] = useState(false);
  const [explosionCountdown, setExplosionCountdown] = useState(5);
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);

  // Diagnostic health report state
  const [healthReport, setHealthReport] = useState<FirebaseHealthReport | null>(null);
  const [isRetesting, setIsRetesting] = useState(false);

  // Legal policy route state
  const [activePolicyPath, setActivePolicyPath] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && isPolicyPath(window.location.pathname)) {
      return window.location.pathname;
    }
    return null;
  });

  // Admin console deep route (/admin) — opens the Admin Console as a standalone page.
  // Auth-gated client-side; every API action inside is re-verified server-side via verifyAdminAuth.
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.replace(/\/+$/, '') === '/admin';
  });

  useEffect(() => {
    const handleAdminPop = () => {
      setIsAdminRoute(window.location.pathname.replace(/\/+$/, '') === '/admin');
    };
    window.addEventListener('popstate', handleAdminPop);
    return () => window.removeEventListener('popstate', handleAdminPop);
  }, []);

  useEffect(() => {
    const handlePolicyNav = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>;
      if (customEvent.detail && customEvent.detail.path) {
        setActivePolicyPath(customEvent.detail.path);
      }
    };

    window.addEventListener('anviotalk_navigate_policy', handlePolicyNav);
    return () => window.removeEventListener('anviotalk_navigate_policy', handlePolicyNav);
  }, []);

  const performHealthCheck = async () => {
    setIsRetesting(true);
    try {
      const rep = await runFirebaseDiagnostics();
      setHealthReport(rep);
    } catch (e) {
      console.error("Failed to run diagnostics:", e);
    } finally {
      setIsRetesting(false);
    }
  };

  useEffect(() => {
    performHealthCheck();
  }, []);

  const { currentUser, isGuest, userProfile, loading, continueAsGuest, isFirestoreAvailable } = useAuth();

  useEffect(() => {
    const handleResize = () => {
      setViewport(window.innerWidth < 768 ? 'mobile' : 'desktop');
    };
    
    // Set initial viewport
    handleResize();
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Parse deep link target if URL changes
  useEffect(() => {
    if (loading) return;
    const target = parseDeepLink(window.location.pathname, window.location.search);
    if (target) {
      if (target.type === 'group' || target.type === 'invite') {
        sessionStorage.setItem('pending_group_invite_id', target.id);
        if (!currentUser && !isGuest) {
          continueAsGuest();
        }
        setActiveScreen('map');
      } else {
        setDeepLinkTarget(target);
      }
    }
  }, [loading, currentUser, isGuest, continueAsGuest]);

  // Listen for Service Worker deep link navigation messages (from notification clicks)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'NAVIGATE_DEEPLINK') {
        const rawUrl = event.data.url;
        if (rawUrl) {
          try {
            const urlObj = new URL(rawUrl, 'https://anviotalk.in');
            const target = parseDeepLink(urlObj.pathname, urlObj.search);
            if (target) {
              setDeepLinkTarget(target);
              setActiveScreen('map');
            }
          } catch (e) {
            console.warn('Could not parse SW deeplink URL:', e);
          }
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSWMessage);
  }, []);

  const closeOverlayRef = useRef<(() => boolean) | null>(null);

  const handleAppBack = useCallback((): boolean => {
    // 1. Policy path overlay
    if (activePolicyPath) {
      setActivePolicyPath(null);
      return true;
    }

    // 2. Deep link target view
    if (deepLinkTarget) {
      setDeepLinkTarget(null);
      return true;
    }

    // 3. Login popup on welcome screen
    if (showLoginPopup) {
      setShowLoginPopup(false);
      return true;
    }

    // 4. In-app overlays in DiscoveryMap (chat, story, profile popup, notifications drawer, sub-tabs)
    if (closeOverlayRef.current && closeOverlayRef.current()) {
      return true;
    }

    // 5. Top-level screen navigation if NOT logged in / not guest
    if (!currentUser && !isGuest) {
      if (activeScreen === 'login' || activeScreen === 'profileSetup') {
        setActiveScreen('welcome');
        return true;
      }
    }

    // Reached root screen
    return false;
  }, [activePolicyPath, deepLinkTarget, showLoginPopup, currentUser, isGuest, activeScreen]);

  // Capacitor Native initialization & Android Back Button handling
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Hide native splash screen & configure status bar
    SplashScreen.hide().catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {});

    // Listen to hardware back button on Android
    const backListenerPromise = AppPlugin.addListener('backButton', () => {
      const handled = handleAppBack();
      if (!handled) {
        AppPlugin.exitApp();
      }
    });

    return () => {
      backListenerPromise.then((listener) => listener.remove());
    };
  }, [handleAppBack]);

  // Handle explosion countdown timer
  useEffect(() => {
    if (!showExplosion) return;

    const interval = setInterval(() => {
      setExplosionCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setShowExplosion(false);
          setShowLoginPopup(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showExplosion]);

  // Dismiss overlay once logged in
  useEffect(() => {
    if (currentUser) {
      setShowExplosion(false);
      setShowLoginPopup(false);
    }
  }, [currentUser]);

  // Synchronize activeScreen and overlays with browser history to support swipe-back / browser navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (isPolicyPath(window.location.pathname)) {
        setActivePolicyPath(window.location.pathname);
        return;
      } else if (activePolicyPath) {
        setActivePolicyPath(null);
        return;
      }

      const handled = handleAppBack();

      if (!handled) {
        if (currentUser || isGuest) {
          // Logged-in users stay safely on 'map', never routed back to welcome/login/profileSetup
          if (activeScreen !== 'map') {
            setActiveScreen('map');
          }
          window.history.replaceState({ screen: 'map' }, '', '');
        } else {
          if (event.state && event.state.screen && event.state.screen !== activeScreen) {
            setActiveScreen(event.state.screen as ScreenType);
          }
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [handleAppBack, currentUser, isGuest, activeScreen, activePolicyPath]);

  // When activeScreen changes programmatically, sync history state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentHistoryState = window.history.state;

    if (currentUser || isGuest) {
      if (activeScreen === 'map') {
        window.history.replaceState({ screen: 'map' }, '', '');
      }
    } else {
      if (!currentHistoryState || currentHistoryState.screen !== activeScreen) {
        if (!currentHistoryState) {
          window.history.replaceState({ screen: activeScreen }, '', '');
        } else {
          window.history.pushState({ screen: activeScreen }, '', '');
        }
      }
    }
  }, [activeScreen, currentUser, isGuest]);

  // Automatically sync active screen with auth/guest state and profile completion
  useEffect(() => {
    if (loading) return;

    if (currentUser) {
      // Do not route until userProfile is loaded from Firestore
      if (userProfile === null) return;

      const uid = currentUser.uid;
      const localOnboardingDone = typeof window !== 'undefined' && (
        localStorage.getItem(`aura_onboarding_completed_${uid}`) === 'true' ||
        localStorage.getItem(`aura_skipped_onboarding_${uid}`) === 'true'
      );

      const hasCompleted = 
        userProfile.hasCompletedProfileSetup === true || 
        userProfile.profileCompleted === true || 
        userProfile.skippedProfileSetup === true ||
        localOnboardingDone;

      if (hasCompleted) {
        if (activeScreen === 'welcome' || activeScreen === 'login' || activeScreen === 'profileSetup') {
          setActiveScreen('map');
        }
      } else {
        if (activeScreen === 'welcome' || activeScreen === 'login') {
          setActiveScreen('profileSetup');
        }
      }
    } else if (isGuest) {
      setActiveScreen('map');
    } else {
      // Auto-guest routing for shared profile or group links
      const pathname = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      const hasProfileParam = searchParams.get('profile');
      const hasGroupParam = searchParams.get('group') || searchParams.get('invite');
      if (hasGroupParam || pathname.includes('/group/') || pathname.includes('/invite/')) {
        continueAsGuest();
        setActiveScreen('map');
      } else if (pathname.includes('/profile/') || hasProfileParam) {
        // Let them stay on welcome screen so they see the explosion & login prompt first!
        setActiveScreen('welcome');
      } else {
        // Not logged in and not guest
        if (activeScreen === 'map' || activeScreen === 'profileSetup') {
          setActiveScreen('welcome');
        }
      }
    }
  }, [currentUser, isGuest, userProfile, loading, continueAsGuest]);

  const handleNextSlide = () => {
    if (currentSlide < 2) {
      setCurrentSlide(currentSlide + 1);
    } else {
      setActiveScreen('login');
    }
  };

  const handlePrevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleLoginSuccess = () => {
    if (currentUser && userProfile === null) return;
    const hasCompleted = userProfile 
      ? (userProfile.hasCompletedProfileSetup === true || 
         userProfile.profileCompleted === true || 
         userProfile.skippedProfileSetup === true)
      : false;

    if (hasCompleted) {
      setActiveScreen('map');
    } else {
      setActiveScreen('profileSetup');
    }
  };

  // Render our professional dark splash screen until auth and userProfile are loaded
  if (loading || (currentUser && userProfile === null)) {
    return <SplashIntro />;
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case 'welcome':
        return (
          <WelcomeScreen 
            viewport={viewport}
            currentSlide={currentSlide}
            onNextSlide={handleNextSlide}
            onPrevSlide={handlePrevSlide}
            onNavigateToLogin={() => setActiveScreen('login')}
            onNavigateToMap={() => setActiveScreen('login')}
          />
        );
      case 'login':
        return (
          <LoginScreen 
            viewport={viewport}
            onLoginSuccess={handleLoginSuccess}
            onContinueAsGuest={() => {
              setActiveScreen('map');
            }}
          />
        );
      case 'profileSetup':
        return (
          <ErrorBoundary fallback={
            <div className="w-full h-full flex items-center justify-center p-4 bg-[#0A0A0A]">
              <div className="max-w-md bg-[#1A1A1A] border border-[#2A2A2A] rounded-[2.5rem] p-8 text-center shadow-md text-white">
                <span className="text-3xl">⚙️</span>
                <h3 className="text-lg font-black text-white mt-4 mb-2">Setup Screen Error</h3>
                <p className="text-xs text-[#B5B5B5] font-medium mb-6">A problem occurred loading the setup steps. Try reloading the setup panel.</p>
                <button onClick={() => window.location.reload()} className="w-full h-11 bg-[#DDF639] text-black rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer">
                  Retry Setup
                </button>
              </div>
            </div>
          }>
            <div className="w-full h-full flex items-center justify-center p-4 bg-[#0A0A0A] overflow-y-auto">
              <ProfileSetupScreen 
                onComplete={() => {
                  setActiveScreen('map');
                }}
              />
            </div>
          </ErrorBoundary>
        );
      case 'map':
        return (
          <ErrorBoundary fallback={
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#09090b]">
              <div className="max-w-md bg-[#18181b] border border-[#27272a] rounded-[2.5rem] p-8 shadow-xl text-white">
                <div className="w-16 h-16 bg-[#DDF639]/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-[#DDF639]/20">
                  <span className="text-[#DDF639] text-3xl">🗺️</span>
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight mb-2">Discovery Map is offline</h3>
                <p className="text-sm text-[#71717A] font-medium mb-8 leading-relaxed">
                  A connection error occurred while rendering the interactive layout. Check your network and try again.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full h-12 bg-[#DDF639] text-black rounded-xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-95 transition-all cursor-pointer"
                >
                  Refresh Map
                </button>
              </div>
            </div>
          }>
            <DiscoveryMap 
              viewport={viewport}
              isGuest={isGuest}
              onNavigateToLogin={() => setActiveScreen('login')}
              onNavigateToProfileSetup={() => setActiveScreen('profileSetup')}
              onRegisterOverlayHandler={(handler) => {
                closeOverlayRef.current = handler;
              }}
            />
          </ErrorBoundary>
        );
      default:
        return (
          <div className="p-8 text-center bg-[#1A1A1A] rounded-3xl text-white">
            <p className="text-[#B5B5B5]">View Unavailable</p>
          </div>
        );
    }
  };

  // Priority Route: Render Policy Page if user visited or navigated to a legal policy path
  if (activePolicyPath) {
    return (
      <LegalPolicyPage
        currentPath={activePolicyPath}
        onNavigate={(path) => {
          navigateToPolicyPath(path);
          setActivePolicyPath(path);
        }}
        onClose={() => {
          setActivePolicyPath(null);
          if (window.history.length > 1 && window.history.state?.isPolicy) {
            window.history.back();
          } else {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    );
  }

  if (showSplash) {
    return <SplashIntro onComplete={() => {
      setShowSplash(false);
    }} />;
  }

  // Standalone Admin Console route: /admin
  if (isAdminRoute) {
    if (loading) {
      return (
        <div className="w-screen h-[100dvh] flex flex-col items-center justify-center bg-[#0A0A0A] text-white gap-4 font-sans">
          <Loader2 className="w-8 h-8 text-[#DDF639] animate-spin" />
          <p className="text-xs text-white/60 font-bold uppercase tracking-widest">Verifying admin session…</p>
        </div>
      );
    }

    if (!currentUser) {
      return (
        <div className="w-screen h-[100dvh] flex flex-col items-center justify-center bg-[#0A0A0A] text-white p-6 text-center font-sans">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-5">
            <Lock className="w-7 h-7 text-rose-400" />
          </div>
          <h1 className="text-lg font-black uppercase tracking-wider mb-2">Admin Access Only</h1>
          <p className="text-xs text-white/60 max-w-xs leading-relaxed mb-6">
            Sign in with an approved administrator account to open the console.
            Every panel action is verified server-side.
          </p>
          <button
            onClick={() => { window.history.pushState({}, '', '/'); setIsAdminRoute(false); }}
            className="px-6 py-3 bg-[#DDF639] text-black text-xs font-black uppercase tracking-wider rounded-xl active:scale-95 transition cursor-pointer"
          >
            Back to App
          </button>
        </div>
      );
    }

    return (
      <div className="w-screen h-[100dvh] bg-[#0A0A0A] flex items-center justify-center p-4">
        <AdminPanelModal
          isOpen
          onClose={() => {
            window.history.pushState({}, '', '/');
            setIsAdminRoute(false);
          }}
        />
      </div>
    );
  }

  // Requirement 4: Open ONLY Shared Content
  if (deepLinkTarget) {
    return (
      <StandaloneSharedView
        target={deepLinkTarget}
        onLoginRequest={() => {
          setDeepLinkTarget(null);
          setActiveScreen('login');
        }}
        onOpenFullApp={() => {
          setDeepLinkTarget(null);
          if (currentUser || isGuest) {
            setActiveScreen('map');
          } else {
            setActiveScreen('welcome');
          }
        }}
      />
    );
  }

  // Render Diagnostic Screen if Firebase configuration/services are missing or database connection fails
  if (healthReport && (!healthReport.isFullyConnected || !isFirestoreAvailable)) {
    return (
      <FirebaseDiagnosticScreen 
        report={healthReport} 
        onRefresh={performHealthCheck} 
        isRetesting={isRetesting} 
      />
    );
  }

  return (
    <div className="w-screen h-[100dvh] flex flex-col overflow-hidden select-none antialiased bg-[#0A0A0A]">
      <div className="flex-1 min-h-0 relative">
        {renderScreen()}
      </div>

      {/* Fullscreen Explosion Overlay */}
      {showExplosion && (
        <SharedLinkExplosion countdown={explosionCountdown} />
      )}

      {/* Conditionally Show Login Popup after explosion */}
      {showLoginPopup && !currentUser && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[160] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-lg bg-[#141414] rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col border border-[#2A2A2A] max-h-[90vh]"
          >
            {/* Header / Lock badge */}
            <div className="p-6 pb-2 flex flex-col items-center text-center select-none">
              <div className="w-12 h-12 bg-[#DDF639]/10 border border-[#DDF639]/20 rounded-full flex items-center justify-center mb-3">
                <Lock className="w-5 h-5 text-[#DDF639]" />
              </div>
              <h3 className="text-lg font-black text-white">
                Unlock Creative Salon
              </h3>
              <p className="text-xs text-[#A1A1AA] font-semibold mt-1">
                {pendingGroup 
                  ? "A secure account is required to participate in this group conversation." 
                  : "A secure account is required to explore this creative profile."}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <LoginScreen 
                viewport={viewport}
                onLoginSuccess={() => {
                  setShowLoginPopup(false);
                  handleLoginSuccess();
                }}
                onContinueAsGuest={() => {
                  continueAsGuest();
                  setShowLoginPopup(false);
                  setActiveScreen('map');
                }}
              />
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
