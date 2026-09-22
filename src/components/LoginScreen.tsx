import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, Lock, Sparkles, Loader2, ArrowRight, 
  Mail, KeyRound, AlertCircle, Eye, EyeOff, CheckCircle2, User,
  ShieldAlert, Copy, Check
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { navigateToPolicyPath } from '../utils/policyNavigation';
import { formatUserFriendlyErrorMessage } from '../utils/errorMessage';

const FOOTER_LEGAL_LINKS = [
  { title: 'Terms & Conditions', path: '/terms-and-conditions' },
  { title: 'Privacy Policy', path: '/privacy-policy' },
  { title: 'Community Guidelines', path: '/community-guidelines' },
  { title: 'Safety Tips', path: '/safety-tips' },
  { title: 'Contact Us', path: '/contact-us' },
];

interface LoginScreenProps {
  viewport: 'desktop' | 'mobile';
  onLoginSuccess: () => void;
  onContinueAsGuest: () => void;
}

export default function LoginScreen({ viewport, onLoginSuccess, onContinueAsGuest }: LoginScreenProps) {
  const { logIn, signUp, logInWithGoogle, continueAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGuestLoading, setIsGuestLoading] = useState(false);
  const [isEmailFormOpen, setIsEmailFormOpen] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [isSignUp, setIsSignUp] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');

  const handleGoogleSignIn = async () => {
    if (isGoogleLoading || isGuestLoading || isEmailLoading || success) return;
    setIsGoogleLoading(true);
    setError('');

    try {
      await logInWithGoogle();
      setSuccess(true);
      setTimeout(() => {
        onLoginSuccess();
      }, 800);
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Google authentication failed.'));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleGuestSignIn = () => {
    if (isGoogleLoading || isGuestLoading || isEmailLoading || success) return;
    setIsGuestLoading(true);
    setError('');

    try {
      continueAsGuest();
      setSuccess(true);
      setTimeout(() => {
        onContinueAsGuest();
      }, 800);
    } catch (err: any) {
      setError('Guest session initialization failed.');
    } finally {
      setIsGuestLoading(false);
    }
  };

  const handleEmailFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmailLoading || success) return;
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setIsEmailLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password, username, displayName);
      } else {
        await logIn(email, password);
      }
      setSuccess(true);
      setTimeout(() => {
        onLoginSuccess();
      }, 800);
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Authentication failed.'));
    } finally {
      setIsEmailLoading(false);
    }
  };

  const GoogleLogo = () => (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );

  return (
    <div className="w-full h-full bg-[#0A0A0A] flex flex-col justify-center items-center p-6 md:p-12 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[420px] space-y-10"
      >
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-[#E5FF3B] rounded-2xl flex items-center justify-center shadow-[0_10px_40px_rgba(229,255,59,0.3)] mx-auto mb-6">
            <Sparkles className="w-8 h-8 text-black" />
          </div>
          <h2 className="text-4xl font-extrabold text-white tracking-tight">Rejoin the Circle.</h2>
          <p className="text-sm text-[#A1A1AA] font-medium leading-relaxed">
            Welcome back to the creative ecosystem. Sign in to continue your connection journey.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading || success}
            className="w-full h-14 bg-white hover:bg-zinc-100 text-black rounded-2xl flex items-center justify-center gap-4 px-6 text-[14px] font-black tracking-tight transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-xl"
          >
            {isGoogleLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleLogo />}
            <span>Continue with Google</span>
          </button>

          <button
            onClick={handleGuestSignIn}
            className="w-full h-14 bg-[#141414] hover:bg-[#1E1E1E] text-white border border-[#2A2A2A] rounded-2xl flex items-center justify-center gap-4 px-6 text-[14px] font-black tracking-tight transition-all active:scale-[0.98] cursor-pointer"
          >
            <User className="w-5 h-5 text-[#A1A1AA]" />
            <span>Continue as Guest</span>
          </button>

          <div className="py-2 text-center">
            <button
              onClick={() => setIsEmailFormOpen(!isEmailFormOpen)}
              className="text-xs font-black text-[#E5FF3B] uppercase tracking-[0.1em] hover:underline cursor-pointer"
            >
              {isEmailFormOpen ? "Hide Email Form" : "Or use Email Address"}
            </button>
          </div>

          <AnimatePresence>
            {isEmailFormOpen && (
              <motion.form
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleEmailFormSubmit}
                className="space-y-4"
              >
                <div className="flex bg-[#141414] p-1 rounded-xl border border-[#2A2A2A]">
                  <button type="button" onClick={() => setIsSignUp(false)} className={`flex-1 py-2 text-xs font-black rounded-lg transition-all ${!isSignUp ? 'bg-[#1E1E1E] text-[#E5FF3B]' : 'text-[#737373]'}`}>Sign In</button>
                  <button type="button" onClick={() => setIsSignUp(true)} className={`flex-1 py-2 text-xs font-black rounded-lg transition-all ${isSignUp ? 'bg-[#1E1E1E] text-[#E5FF3B]' : 'text-[#737373]'}`}>Sign Up</button>
                </div>

                {isSignUp && (
                  <>
                    <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display Name" className="w-full h-12 bg-[#141414] border border-[#2A2A2A] rounded-xl px-5 text-sm text-white focus:border-[#E5FF3B] outline-none transition-all placeholder:text-zinc-600" />
                    <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Unique Username" className="w-full h-12 bg-[#141414] border border-[#2A2A2A] rounded-xl px-5 text-sm text-white focus:border-[#E5FF3B] outline-none transition-all placeholder:text-zinc-600" />
                  </>
                )}

                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" className="w-full h-12 bg-[#141414] border border-[#2A2A2A] rounded-xl px-5 text-sm text-white focus:border-[#E5FF3B] outline-none transition-all placeholder:text-zinc-600" />
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full h-12 bg-[#141414] border border-[#2A2A2A] rounded-xl px-5 text-sm text-white focus:border-[#E5FF3B] outline-none transition-all placeholder:text-zinc-600" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>

                <button type="submit" disabled={isEmailLoading} className="w-full h-12 bg-[#E5FF3B] text-black font-black rounded-xl text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-[#E5FF3B]/10 active:scale-95 transition-all">
                  {isEmailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isSignUp ? 'Create Account' : 'Sign In')}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <footer className="pt-10 flex flex-col items-center gap-6">
          <div className="flex gap-4">
            <ShieldCheck className="w-5 h-5 text-[#E5FF3B]" />
            <Lock className="w-5 h-5 text-[#E5FF3B]" />
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[10px] font-black uppercase tracking-widest text-[#737373]">
            {FOOTER_LEGAL_LINKS.map(link => (
              <button key={link.path} onClick={() => navigateToPolicyPath(link.path)} className="hover:text-white transition-colors">{link.title}</button>
            ))}
          </div>
        </footer>
      </motion.div>
    </div>
  );
}
