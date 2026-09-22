import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CheckCircle2, Clock, TrendingUp, Landmark, 
  CreditCard, ArrowUpRight, ChevronRight, ShieldAlert,
  Eye, MessageSquare, Sparkles, Info, RefreshCw, Lock, Users,
  DollarSign, Wallet, Image
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, ChatThread } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { formatUserFriendlyErrorMessage } from '../utils/errorMessage';

export type MonetizationStatus = 
  | 'Not Eligible' 
  | 'In Progress' 
  | 'Eligible' 
  | 'Under Review' 
  | 'Approved' 
  | 'Paused' 
  | 'Suspended';

export interface PaymentMethodData {
  type: 'bank_upi';
  upiId?: string;
  accountHolderName?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  isVerified?: boolean;
  updatedAt?: string;
}

const RATE_INR = 40;
const CONVERSION_RATE = 83.5;
const MIN_WITHDRAWAL_USD = 100;

interface ProfileMonetizationProps {
  profile: UserProfile;
  chats: ChatThread[];
  userStoriesCount: number;
  onBack?: () => void;
  onUpdateProfile: (updated: UserProfile) => void;
}

export default function ProfileMonetization({
  profile,
  chats,
  userStoriesCount,
  onBack,
  onUpdateProfile
}: ProfileMonetizationProps) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || profile.uid || profile.id || 'guest';

  // State management
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Monetization metrics forced to Approved (Eligibility Criteria Removed)
  const [monetizationStatus, setMonetizationStatus] = useState<MonetizationStatus>('Approved');
  const [monthName, setMonthName] = useState<string>('September 2026');

  // Verified view counts per source — REAL data from the server (anti-fraud filtered, real-time)
  const [profileViewsCount, setProfileViewsCount] = useState<number>(0);
  const [storyViewsCount, setStoryViewsCount] = useState<number>(0);
  const [chatViewsCount, setChatViewsCount] = useState<number>(0);
  const [groupViewsCount, setGroupViewsCount] = useState<number>(0);

  const [activeSection, setActiveSection] = useState<'dashboard' | 'apply'>('dashboard');

  // Payment Method state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodData>({
    type: 'bank_upi',
    upiId: '',
    accountHolderName: '',
    bankAccountNumber: '',
    ifscCode: '',
    bankName: '',
    isVerified: false
  });
  const [upiIdInput, setUpiIdInput] = useState('');
  const [accountHolderNameInput, setAccountHolderNameInput] = useState('');
  const [bankAccountNumberInput, setBankAccountNumberInput] = useState('');
  const [ifscCodeInput, setIfscCodeInput] = useState('');
  const [bankNameInput, setBankNameInput] = useState('');

  const [paymentSavedToast, setPaymentSavedToast] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  // Payout request state
  const [isRequestingPayout, setIsRequestingPayout] = useState(false);
  const [payoutToastMsg, setPayoutToastMsg] = useState<string | null>(null);

  const [unpaidBalanceUsd, setUnpaidBalanceUsd] = useState<number>(0);

  const getAuthHeaders = useCallback(async () => {
    const token = await currentUser?.getIdToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }, [currentUser]);

  const fetchMonetizationMetrics = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/monetization/status/${uid}`, { headers });
      if (res.ok) {
        const data = await res.json();
        // Force Approved state regardless of backend response
        setMonetizationStatus('Approved');
        setMonthName(data.monthName || '');

        // Real-time verified view counts per source (₹40 per 1k views)
        setProfileViewsCount(data.profileViews ?? data.uniqueViewsCount ?? 0);
        setStoryViewsCount(data.storyViews ?? 0);
        setChatViewsCount(data.chatViews ?? 0);
        setGroupViewsCount(data.groupViews ?? 0);
        if (data.unpaidBalanceUsd !== undefined) setUnpaidBalanceUsd(data.unpaidBalanceUsd);

        if (data.paymentMethod) {
          setPaymentMethod(data.paymentMethod);
          setUpiIdInput(data.paymentMethod.upiId || '');
          setAccountHolderNameInput(data.paymentMethod.accountHolderName || '');
          setBankAccountNumberInput(data.paymentMethod.bankAccountNumber || '');
          setIfscCodeInput(data.paymentMethod.ifscCode || '');
          setBankNameInput(data.paymentMethod.bankName || '');
        }
      }
    } catch (err) {
      console.warn('[Monetization] Fetch failed, using UI defaults');
    } finally {
      setLoading(false);
    }
  }, [uid, getAuthHeaders]);

  useEffect(() => {
    fetchMonetizationMetrics();
  }, [fetchMonetizationMetrics]);

  useEffect(() => {
    if (!uid || uid === 'guest') return;
    const statusDocRef = doc(db, "users", uid, "monetization", "status");
    const unsub = onSnapshot(statusDocRef, (snap) => {
      if (snap.exists()) fetchMonetizationMetrics();
    });
    return () => unsub();
  }, [uid, fetchMonetizationMetrics]);

  // Real-time earnings: poll verified view counts every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMonetizationMetrics();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchMonetizationMetrics]);

  const handleSavePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPayment(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/monetization/payment-method', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          creatorId: uid,
          upiId: upiIdInput.trim(),
          accountHolderName: accountHolderNameInput.trim(),
          bankAccountNumber: bankAccountNumberInput.trim(),
          ifscCode: ifscCodeInput.trim().toUpperCase(),
          bankName: bankNameInput.trim()
        })
      });
      if (res.ok) {
        setPaymentSavedToast(true);
        setTimeout(() => setPaymentSavedToast(false), 3000);
      }
    } catch (err) {
      alert("Failed to save payment details.");
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleRequestWithdrawal = async () => {
    setIsRequestingPayout(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/monetization/request-withdrawal', {
        method: 'POST',
        headers,
        body: JSON.stringify({ totalAmountUsd: totalCalculatedEarningsUsd + unpaidBalanceUsd })
      });
      if (res.ok) {
        setPayoutToastMsg("Withdrawal request sent!");
        fetchMonetizationMetrics();
      }
    } catch (err) {
      alert("Withdrawal failed.");
    } finally {
      setIsRequestingPayout(false);
    }
  };

  const getStatusBadge = (status: MonetizationStatus) => {
    switch (status) {
      case 'Approved':
        return { bg: 'bg-[#D7FF3F]/10 border-[#D7FF3F]/30 text-[#D7FF3F]', icon: CheckCircle2, label: 'MONETIZED', glow: 'shadow-[0_0_15px_rgba(215,255,63,0.3)]' };
      case 'Eligible':
        return { bg: 'bg-emerald-400/10 border-emerald-400/30 text-emerald-400', icon: Sparkles, label: 'ELIGIBLE', glow: '' };
      case 'Under Review':
        return { bg: 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400', icon: RefreshCw, label: 'REVIEWING', glow: '' };
      case 'Paused':
      case 'Suspended':
        return { bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400', icon: ShieldAlert, label: status.toUpperCase(), glow: '' };
      default:
        return { bg: 'bg-amber-400/10 border-amber-400/30 text-amber-400', icon: Clock, label: 'IN PROGRESS', glow: '' };
    }
  };

  // Real-time verified view counts per source (₹40 per 1k views)
  // Earning is continuous as requested: (count / 1000 * RATE_INR) / CONVERSION_RATE
  const earningsForCount = (count: number) => (count / 1000 * RATE_INR) / CONVERSION_RATE;

  const profileViewsEarningsUsd = earningsForCount(profileViewsCount);
  const storyViewsEarningsUsd = earningsForCount(storyViewsCount);
  const chatViewsEarningsUsd = earningsForCount(chatViewsCount);
  const groupViewsEarningsUsd = earningsForCount(groupViewsCount);

  const totalCalculatedEarningsUsd = profileViewsEarningsUsd + storyViewsEarningsUsd + chatViewsEarningsUsd + groupViewsEarningsUsd;
  const totalAvailableBalance = totalCalculatedEarningsUsd;

  const isWithdrawalEligible = totalAvailableBalance >= MIN_WITHDRAWAL_USD;
  const hasEarnings = totalAvailableBalance > 0;

  // Goals for "In Progress" / "Eligible" state
  const GOALS = { views: 500, chats: 20, followers: 100, storyDays: 7 };
  const getProgress = (val: number, target: number) => Math.min(100, (val / target) * 100);

  const statusInfo = getStatusBadge(monetizationStatus);
  const StatusIcon = statusInfo.icon;

  return (
    <div className="w-full max-w-[640px] mx-auto text-left space-y-6 pb-12 font-sans px-2 sm:px-0">
      
      {/* 1. HEADER SECTION */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4"
      >
        <div className="flex items-center gap-4 min-w-0 w-full sm:w-auto">
          {onBack && (
            <button 
              onClick={onBack}
              className="w-10 h-10 rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] text-[#B5B5B5] hover:text-[#E5FF3B] flex items-center justify-center cursor-pointer transition-all active:scale-90 shrink-0"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#E5FF3B]" />
              Wallet & Earnings
            </h2>
            <p className="text-[10px] text-[#8A8A8A] font-bold uppercase tracking-widest mt-0.5">
              Live Creator Revenue Program
            </p>
          </div>
        </div>

        <div className={`px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all duration-500 ${statusInfo.bg} ${statusInfo.glow}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${monetizationStatus === 'Approved' ? 'animate-pulse' : ''}`} />
          <span>{statusInfo.label}</span>
        </div>
      </motion.div>

      {/* 2. TAB NAVIGATION (ONLY IF EARNINGS EXIST) */}
      {hasEarnings && (
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-1 flex gap-1 shadow-inner">
          {(['dashboard', 'apply'] as const).map((sec) => (
            <button
              key={sec}
              onClick={() => setActiveSection(sec)}
              className={`flex-1 py-3 px-4 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeSection === sec
                  ? 'bg-[#E5FF3B] text-black shadow-lg scale-[1.02]'
                  : 'text-[#8A8A8A] hover:text-white hover:bg-[#1A1A1A]'
              }`}
            >
              {sec === 'dashboard' ? <TrendingUp className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
              {sec === 'dashboard' ? 'Dashboard' : 'Apply to Withdraw'}
            </button>
          ))}
        </div>
      )}

      {activeSection === 'dashboard' ? (
        <div className="space-y-6">
          
          {/* A. MAIN BALANCE CARD */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative bg-gradient-to-br from-[#1E1E1E] to-[#0A0A0A] border border-[#2A2A2A] rounded-[2rem] p-7 overflow-hidden shadow-2xl group"
          >
            {/* Visual Flair */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#E5FF3B]/10 rounded-full blur-[100px] -mr-32 -mt-32 transition-transform duration-1000 group-hover:scale-110" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/5 rounded-full blur-[60px] -ml-16 -mb-16" />

            <div className="relative z-10 flex flex-col sm:flex-row justify-between items-center sm:items-end gap-6">
              <div className="text-center sm:text-left w-full sm:w-auto">
                <span className="text-[10px] font-black text-[#E5FF3B] uppercase tracking-[0.25em] bg-[#E5FF3B]/10 px-4 py-1.5 rounded-full border border-[#E5FF3B]/20 inline-block mb-4 shadow-sm">
                  Available Balance
                </span>
                <div className="flex items-baseline justify-center sm:justify-start gap-3">
                  <span className="text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                    ${totalCalculatedEarningsUsd.toFixed(2)}
                  </span>
                  <span className="text-sm font-black text-[#E5FF3B]/60 italic tracking-widest">USD</span>
                </div>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-3">
                  <div className="h-px w-8 bg-[#2A2A2A]" />
                  <span className="text-sm font-extrabold text-[#E5FF3B]">≈ ₹{(totalCalculatedEarningsUsd * CONVERSION_RATE).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  <span className="text-[9px] font-black text-[#555] uppercase tracking-widest">Live Valuation</span>
                </div>
              </div>

              {hasEarnings ? (
                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 p-6 rounded-[1.8rem] w-full sm:w-auto min-w-[220px] shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#E5FF3B]/20 to-transparent" />
                  <p className="text-[10px] font-black text-[#8A8A8A] uppercase tracking-[0.2em] mb-3">Goal Progress</p>
                  <div className="flex justify-between items-end mb-4">
                    <span className="text-2xl font-mono font-black text-white leading-none">${totalAvailableBalance.toFixed(0)}<span className="text-[11px] text-[#444] font-bold"> / $100</span></span>
                    <span className="text-[10px] font-black text-[#E5FF3B] mb-0.5">{Math.min(100, Math.floor((totalAvailableBalance / 100) * 100))}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#1A1A1A] rounded-full overflow-hidden border border-white/5 mb-5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (totalAvailableBalance / 100) * 100)}%` }}
                      className="h-full bg-gradient-to-r from-[#B5FF3B] to-[#E5FF3B] shadow-[0_0_10px_rgba(229,255,59,0.4)]"
                    />
                  </div>
                  <button
                    onClick={() => setActiveSection('apply')}
                    className="w-full h-11 bg-white text-black text-[10px] font-black uppercase tracking-wider rounded-xl shadow-xl hover:bg-[#E5FF3B] transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    Apply to Withdraw <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              ) : null}
            </div>
          </motion.div>

          {/* ELIGIBILITY PROGRESS REMOVED */}

          {/* C. REVENUE STREAM GRID — ₹40 per 1k verified views per source */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { id: 1, label: 'Profile Views', value: profileViewsEarningsUsd, count: profileViewsCount, icon: Eye, color: '#E5FF3B' },
              { id: 2, label: 'Story Views', value: storyViewsEarningsUsd, count: storyViewsCount, icon: Image, color: '#EC4899' },
              { id: 3, label: 'Chat Views', value: chatViewsEarningsUsd, count: chatViewsCount, icon: MessageSquare, color: '#3B82F6' },
              { id: 4, label: 'Group Views', value: groupViewsEarningsUsd, count: groupViewsCount, icon: Users, color: '#A855F7' },
            ].map((stream) => (
              <motion.div
                key={stream.id}
                whileHover={{ y: -5, scale: 1.02 }}
                className="bg-[#1A1A1A] border border-[#2A2A2A] p-5 rounded-3xl flex flex-col items-center text-center gap-3 group transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center group-hover:border-white/20 transition-all shadow-inner">
                  <stream.icon className="w-6 h-6" style={{ color: stream.color }} />
                </div>
                <div>
                  <h4 className="text-[10px] font-black text-[#8A8A8A] uppercase tracking-[0.15em] mb-1">{stream.label}</h4>
                  <p className="text-xl font-black text-white font-mono tracking-tight">${stream.value.toFixed(2)}</p>
                  <p className="text-[9px] font-bold text-[#555] uppercase mt-1">
                    {stream.count.toLocaleString()} views • ₹{RATE_INR}/1k
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          <p className="text-[10px] text-[#444] text-center font-bold uppercase tracking-[0.3em] py-4">
            Secured by Anvio Protocol &copy; 2026
          </p>

        </div>
      ) : (
        /* ========================================================================= */
        /* 3. APPLY TO WITHDRAW & SETTLEMENT SECTION (ENHANCED FORM)                 */
        /* ========================================================================= */
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          {/* Wallet Balance Card */}
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-[2rem] p-7 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-2xl">
            <div className="text-center sm:text-left">
              <span className="text-[10px] font-black text-[#8A8A8A] uppercase tracking-widest mb-1 block">Payable Balance</span>
              <div className="flex items-baseline justify-center sm:justify-start gap-2">
                <span className="text-4xl font-black text-white font-mono">${totalAvailableBalance.toFixed(2)}</span>
                <span className="text-xs font-bold text-[#E5FF3B]">USD</span>
              </div>
            </div>

            <button
              onClick={handleRequestWithdrawal}
              disabled={isRequestingPayout || !isWithdrawalEligible}
              className={`h-14 px-8 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-xl flex items-center gap-3 relative group ${
                isWithdrawalEligible
                  ? 'bg-[#E5FF3B] text-black hover:scale-105 active:scale-95 cursor-pointer'
                  : 'bg-[#2A2A2A] text-[#555] cursor-not-allowed opacity-60'
              }`}
            >
              {isRequestingPayout ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : isWithdrawalEligible ? (
                <DollarSign className="w-5 h-5" />
              ) : (
                <Lock className="w-4 h-4 text-[#444]" />
              )}
              {isWithdrawalEligible ? 'Apply Now' : 'Apply (Locked)'}

              {!isWithdrawalEligible && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-white text-[9px] px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-white/10">
                  Minimum $100 required to apply
                </div>
              )}
            </button>
          </div>

          {/* Form */}
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-[2rem] p-8 shadow-md">
            <div className="flex items-center justify-between mb-8 border-b border-[#2A2A2A] pb-5">
              <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-[#E5FF3B]" /> Settlement Details
              </h3>
              {paymentSavedToast && (
                <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 animate-bounce">
                  SAVED!
                </span>
              )}
            </div>

            <form onSubmit={handleSavePaymentMethod} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {[
                  { label: 'UPI ID (PhonePe/Paytm)', value: upiIdInput, setter: setUpiIdInput, ph: 'user@upi', required: true },
                  { label: 'Account Holder Name', value: accountHolderNameInput, setter: setAccountHolderNameInput, ph: 'Full Name', required: true },
                  { label: 'Account Number', value: bankAccountNumberInput, setter: setBankAccountNumberInput, ph: '0000000000', required: true },
                  { label: 'IFSC Code', value: ifscCodeInput, setter: setIfscCodeInput, ph: 'SBIN0001234', required: true, caps: true },
                ].map((field) => (
                  <div key={field.label} className="space-y-2">
                    <label className="text-[10px] font-black text-[#8A8A8A] uppercase tracking-widest block px-1">{field.label}</label>
                    <input
                      type="text"
                      value={field.value}
                      onChange={(e) => field.setter(field.caps ? e.target.value.toUpperCase() : e.target.value)}
                      placeholder={field.ph}
                      required={field.required}
                      className="w-full h-12 bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-4 text-xs font-bold text-white focus:border-[#E5FF3B] outline-none transition-all placeholder-[#333]"
                    />
                  </div>
                ))}
                <div className="sm:col-span-2 space-y-2">
                  <label className="text-[10px] font-black text-[#8A8A8A] uppercase tracking-widest block px-1">Bank Name</label>
                  <input 
                    type="text"
                    value={bankNameInput}
                    onChange={(e) => setBankNameInput(e.target.value)}
                    placeholder="e.g. HDFC Bank"
                    className="w-full h-12 bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-4 text-xs font-bold text-white focus:border-[#E5FF3B] outline-none transition-all placeholder-[#333]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSavingPayment}
                className="w-full h-14 bg-[#E5FF3B] text-black text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-2xl hover:scale-[1.01] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
              >
                {isSavingPayment ? "Registering..." : "Update Settlement Info"}
              </button>
            </form>

            <div className="mt-8 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex items-start gap-4">
              <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#A0A0A0] leading-relaxed font-semibold">
                Please ensure your Bank and UPI details are correct. Incorrect information may delay or result in failed settlements. Payments are processed on the 1st of every month.
              </p>
            </div>
          </div>
        </motion.div>
      )}

    </div>
  );
}
