import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldAlert, CheckCircle2, Clock, Landmark, AlertTriangle, User, Filter, RefreshCw, FileText, Coins, Search, Check, Ban, AlertCircle, Users, BarChart3, Eye, MessageSquare, RotateCcw, AlertOctagon, Mail, Image } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminPanelModal({ isOpen, onClose }: AdminPanelModalProps) {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'payouts' | 'reports' | 'creators' | 'users' | 'monreport'>('creators');

  // Users management state
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'suspended' | 'banned' | 'warned' | 'blocked'>('all');
  const [processingUser, setProcessingUser] = useState<string | null>(null);
  const [userActionModal, setUserActionModal] = useState<{ user: any; action: 'suspend' | 'ban' | 'reactivate' | 'warn' } | null>(null);
  const [userActionNote, setUserActionNote] = useState('');
  const [usersTotalCount, setUsersTotalCount] = useState(0);

  // Monetization report state
  const [monReport, setMonReport] = useState<any | null>(null);
  const [loadingMonReport, setLoadingMonReport] = useState(false);

  // Payouts state
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loadingPayouts, setLoadingPayouts] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState<any | null>(null);
  const [utrInput, setUtrInput] = useState('');
  const [adminNoteInput, setAdminNoteInput] = useState('');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  // Reports state
  const [reports, setReports] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportFilter, setReportFilter] = useState<'all' | 'pending' | 'actioned' | 'dismissed'>('pending');
  const [isProcessingReport, setIsProcessingReport] = useState(false);

  // Creators / Monetization Approvals state
  const [creators, setCreators] = useState<any[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const [creatorSearchQuery, setCreatorSearchQuery] = useState('');
  const [creatorStatusFilter, setCreatorStatusFilter] = useState<'all' | 'Under Review' | 'Eligible' | 'Approved' | 'In Progress' | 'Suspended'>('all');
  const [isProcessingCreator, setIsProcessingCreator] = useState<string | null>(null);

  const getAuthHeaders = useCallback(async () => {
    const token = await currentUser?.getIdToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }, [currentUser]);

  // Fetch Payouts
  const fetchPayouts = useCallback(async () => {
    setLoadingPayouts(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/payouts', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.payouts)) {
          setPayouts(data.payouts);
        }
      }
    } catch (err) {
      console.warn('[Admin] Error fetching payouts:', err);
    } finally {
      setLoadingPayouts(false);
    }
  }, [getAuthHeaders]);

  // Fetch Reports
  const fetchReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/reports?status=${reportFilter}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.reports)) {
          setReports(data.reports);
        }
      }
    } catch (err) {
      console.warn('[Admin] Error fetching reports:', err);
    } finally {
      setLoadingReports(false);
    }
  }, [reportFilter, getAuthHeaders]);

  // Fetch Creators for Monetization
  const fetchCreators = useCallback(async () => {
    setLoadingCreators(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/monetization/admin/creators', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.creators)) {
          setCreators(data.creators);
        }
      }
    } catch (err) {
      console.warn('[Admin] Error fetching creators:', err);
    } finally {
      setLoadingCreators(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'creators') fetchCreators();
      if (activeTab === 'payouts') fetchPayouts();
      if (activeTab === 'reports') fetchReports();
    }
  }, [isOpen, activeTab, fetchCreators, fetchPayouts, fetchReports]);

  // Handle Monetization Status Change (Approve, Review, Suspend)
  const handleMonetizationAction = async (creatorId: string, newStatus: string, note?: string) => {
    setIsProcessingCreator(creatorId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/monetization/admin/approve-creator', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          creatorId,
          status: newStatus,
          note: note || `Updated to ${newStatus} by admin`
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Success: Creator status updated to "${newStatus}"! Earning is now live.`);
        fetchCreators();
      } else {
        alert(data.error || 'Failed to update creator status');
      }
    } catch (err: any) {
      alert('Error updating creator monetization: ' + (err?.message || err));
    } finally {
      setIsProcessingCreator(null);
    }
  };

  // Fetch Users for account management
  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (userSearchQuery.trim()) params.set('search', userSearchQuery.trim());
      if (userStatusFilter !== 'all') params.set('status', userStatusFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          setAdminUsers(data.users);
          setUsersTotalCount(data.total || data.users.length);
        }
      }
    } catch (err) {
      console.warn('[Admin] Error fetching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, [userSearchQuery, userStatusFilter, getAuthHeaders]);

  // Fetch platform-wide monetization report
  const fetchMonReport = useCallback(async () => {
    setLoadingMonReport(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/monetization-report', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setMonReport(data);
      }
    } catch (err) {
      console.warn('[Admin] Error fetching monetization report:', err);
    } finally {
      setLoadingMonReport(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'payouts') fetchPayouts();
      if (activeTab === 'reports') fetchReports();
      if (activeTab === 'users') fetchUsers();
      if (activeTab === 'monreport') fetchMonReport();
    }
  }, [isOpen, activeTab, fetchPayouts, fetchReports, fetchUsers, fetchMonReport]);

  // Handle user account action (suspend/ban/reactivate/warn) with confirmation modal
  const handleUserAction = async () => {
    if (!userActionModal) return;
    const { user, action } = userActionModal;
    setProcessingUser(user.uid);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/users/${user.uid}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, note: userActionNote.trim() || undefined })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUserActionModal(null);
        setUserActionNote('');
        fetchUsers();
      } else {
        alert(data.error || `Failed to ${action} user`);
      }
    } catch (err: any) {
      alert('Error applying account action: ' + (err?.message || err));
    } finally {
      setProcessingUser(null);
    }
  };

  // Handle Payout Action
  const handlePayoutAction = async (payoutId: string, action: 'approve' | 'mark_paid' | 'reject') => {
    setIsProcessingPayout(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/payouts/${payoutId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action,
          transactionReference: utrInput.trim(),
          adminNote: adminNoteInput.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || `Payout ${action} completed`);
        setSelectedPayout(null);
        setUtrInput('');
        setAdminNoteInput('');
        fetchPayouts();
      } else {
        alert(data.error || `Failed to ${action} payout`);
      }
    } catch (err: any) {
      alert('Error updating payout: ' + err?.message);
    } finally {
      setIsProcessingPayout(false);
    }
  };

  // Handle Report Action
  const handleReportAction = async (reportId: string, action: 'dismiss' | 'warn' | 'suspend_user') => {
    setIsProcessingReport(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/reports/${reportId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action,
          adminNote: adminNoteInput.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || `Report action '${action}' applied`);
        setAdminNoteInput('');
        fetchReports();
      } else {
        alert(data.error || 'Failed to update report');
      }
    } catch (err: any) {
      alert('Error processing report: ' + err?.message);
    } finally {
      setIsProcessingReport(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-[#141414] border border-[#2C3222] rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-5 border-b border-[#2C3222] flex items-center justify-between bg-[#1A1A1A]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#D7FF3F]/10 border border-[#D7FF3F]/30 flex items-center justify-center text-[#D7FF3F]">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-white uppercase tracking-wider">Anvio Talk Admin Console</h2>
                <p className="text-[11px] text-[#A0A0A0]">Manage creator payout requests and community report tickets</p>
              </div>
            </div>

            <button 
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-[#2A2A2A] hover:bg-[#333] text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav Tabs */}
          <div className="p-3 bg-[#1A1A1A] border-b border-[#2C3222] flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveTab('creators')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-all ${
                activeTab === 'creators'
                  ? 'bg-[#D7FF3F] text-black'
                  : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
              }`}
            >
              <Coins className="w-4 h-4" />
              <span>Creator Monetization ({creators.filter(c => c.monetizationStatus === 'Under Review' || c.monetizationStatus === 'Eligible').length} Pending)</span>
            </button>

            <button
              onClick={() => setActiveTab('payouts')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-all ${
                activeTab === 'payouts'
                  ? 'bg-[#D7FF3F] text-black'
                  : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
              }`}
            >
              <Landmark className="w-4 h-4" />
              <span>Payout Requests ({payouts.filter(p => p.status === 'requested').length})</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-all ${
                activeTab === 'reports'
                  ? 'bg-[#D7FF3F] text-black'
                  : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Report Tickets</span>
            </button>

            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-all ${
                activeTab === 'users'
                  ? 'bg-[#D7FF3F] text-black'
                  : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Users ({adminUsers.filter(u => u.accountStatus === 'suspended' || u.accountStatus === 'banned').length} Blocked)</span>
            </button>

            <button
              onClick={() => setActiveTab('monreport')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-all ${
                activeTab === 'monreport'
                  ? 'bg-[#D7FF3F] text-black'
                  : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Monetization Report</span>
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-4">

            {/* CREATORS MONETIZATION TAB */}
            {activeTab === 'creators' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-black text-[#A0A0A0] uppercase tracking-wider">
                      Creator Monetization Management
                    </h3>
                    <p className="text-[11px] text-[#707070]">
                      Review, approve, or pause monetization for creators. Approving unlocks live USD earnings.
                    </p>
                  </div>

                  <button 
                    onClick={fetchCreators}
                    className="text-xs text-[#D7FF3F] hover:underline flex items-center gap-1 cursor-pointer self-start sm:self-auto"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8A8A]" />
                    <input
                      type="text"
                      placeholder="Search creator by username, display name, or UID..."
                      value={creatorSearchQuery}
                      onChange={(e) => setCreatorSearchQuery(e.target.value)}
                      className="w-full bg-[#141414] border border-[#2C3222] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-[#555] focus:outline-none focus:border-[#D7FF3F]"
                    />
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    {(['all', 'Under Review', 'Eligible', 'Approved', 'In Progress', 'Suspended'] as const).map(st => (
                      <button
                        key={st}
                        onClick={() => setCreatorStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap cursor-pointer transition-all ${
                          creatorStatusFilter === st ? 'bg-[#D7FF3F] text-black' : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Creators List */}
                {loadingCreators ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">Loading creators data...</div>
                ) : (
                  (() => {
                    const filtered = creators.filter(c => {
                      if (creatorStatusFilter !== 'all' && c.monetizationStatus !== creatorStatusFilter) return false;
                      if (!creatorSearchQuery.trim()) return true;
                      const q = creatorSearchQuery.toLowerCase().trim();
                      return (
                        c.username?.toLowerCase().includes(q) ||
                        c.displayName?.toLowerCase().includes(q) ||
                        c.uid?.toLowerCase().includes(q) ||
                        c.email?.toLowerCase().includes(q)
                      );
                    });

                    if (filtered.length === 0) {
                      return <div className="py-12 text-center text-xs text-[#8A8A8A]">No creators found matching current filter.</div>;
                    }

                    return (
                      <div className="space-y-3">
                        {filtered.map((c) => {
                          const isApproved = c.monetizationStatus === 'Approved';
                          const isUnderReview = c.monetizationStatus === 'Under Review';
                          const isEligible = c.monetizationStatus === 'Eligible';
                          const isProcessing = isProcessingCreator === c.uid;

                          return (
                            <div key={c.uid} className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2C3222] pb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-[#2A2A2A] overflow-hidden border border-[#333] flex items-center justify-center shrink-0">
                                    {c.avatarUrl ? (
                                      <img src={c.avatarUrl} alt={c.displayName} className="w-full h-full object-cover" />
                                    ) : (
                                      <User className="w-5 h-5 text-[#888]" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-black text-white">{c.displayName}</span>
                                      <span className="text-xs text-[#8A8A8A]">@{c.username}</span>
                                    </div>
                                    <span className="text-[10px] text-[#666] font-mono block">UID: {c.uid}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 self-start sm:self-auto">
                                  <span className="text-xs text-[#A0A0A0] font-bold">
                                    {c.followersCount} followers
                                  </span>
                                  <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider ${
                                    isApproved ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                                    isUnderReview ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                                    isEligible ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' :
                                    c.monetizationStatus === 'Suspended' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' :
                                    'bg-neutral-500/10 text-neutral-400 border border-neutral-500/30'
                                  }`}>
                                    {c.monetizationStatus || 'In Progress'}
                                  </span>
                                </div>
                              </div>

                              {/* 5 Eligibility Criteria Summary */}
                              <div className="bg-[#10150c] border border-[#2C3222] p-2.5 rounded-xl space-y-1.5">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                                  <span className="text-[#A0A0A0]">5 Monthly Eligibility Benchmarks</span>
                                  <span className={isApproved ? "text-[#D7FF3F]" : "text-[#8A8A8A]"}>
                                    {isApproved ? "100% Granted & Fulfilled ✅" : "Tracked Live"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[9.5px]">
                                  <div className={`p-1.5 rounded-lg border text-center font-mono ${isApproved ? 'bg-[#1A2510] text-[#D7FF3F] border-[#3E5C1B]' : 'bg-[#181818] text-[#888] border-[#2A2A2A]'}`}>
                                    <span className="block text-[7.5px] uppercase text-[#777]">Views</span>
                                    {isApproved ? '500 / 500' : `${Math.min(c.uniqueViewsCount || 0, 500)}/500`}
                                  </div>
                                  <div className={`p-1.5 rounded-lg border text-center font-mono ${isApproved ? 'bg-[#1A2510] text-[#D7FF3F] border-[#3E5C1B]' : 'bg-[#181818] text-[#888] border-[#2A2A2A]'}`}>
                                    <span className="block text-[7.5px] uppercase text-[#777]">Chats</span>
                                    {isApproved ? '20 / 20' : `${Math.min(c.uniqueChatsCount || 0, 20)}/20`}
                                  </div>
                                  <div className={`p-1.5 rounded-lg border text-center font-mono ${isApproved ? 'bg-[#1A2510] text-[#D7FF3F] border-[#3E5C1B]' : 'bg-[#181818] text-[#888] border-[#2A2A2A]'}`}>
                                    <span className="block text-[7.5px] uppercase text-[#777]">Followers</span>
                                    {isApproved ? `${Math.max(c.followersCount || 0, 100)}/100` : `${c.followersCount || 0}/100`}
                                  </div>
                                  <div className={`p-1.5 rounded-lg border text-center font-mono ${isApproved ? 'bg-[#1A2510] text-[#D7FF3F] border-[#3E5C1B]' : 'bg-[#181818] text-[#888] border-[#2A2A2A]'}`}>
                                    <span className="block text-[7.5px] uppercase text-[#777]">Active Days</span>
                                    {isApproved ? '7 / 7d' : `${Math.min(c.activeDaysCount || 0, 7)}/7d`}
                                  </div>
                                  <div className={`p-1.5 rounded-lg border text-center font-mono ${isApproved ? 'bg-[#1A2510] text-[#D7FF3F] border-[#3E5C1B]' : 'bg-[#181818] text-[#888] border-[#2A2A2A]'}`}>
                                    <span className="block text-[7.5px] uppercase text-[#777]">Story Days</span>
                                    {isApproved ? '7 / 7d' : `${Math.min(c.storyUploadDaysCount || 0, 7)}/7d`}
                                  </div>
                                </div>
                              </div>

                              {/* Details Info */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] bg-[#141414] p-3 rounded-xl border border-[#2C3222]">
                                <div>
                                  <span className="text-[9px] font-bold text-[#8A8A8A] block">MONETIZATION STATUS</span>
                                  <span className="text-white font-mono font-bold">{c.monetizationStatus || 'In Progress'}</span>
                                  {c.approvedAt && (
                                    <span className="text-[9px] text-[#888] block">Approved: {new Date(c.approvedAt).toLocaleDateString()}</span>
                                  )}
                                </div>
                                <div>
                                  <span className="text-[9px] font-bold text-[#8A8A8A] block">PAYMENT METHOD</span>
                                  <span className="text-white font-mono">
                                    {c.paymentMethod?.upiId ? `UPI: ${c.paymentMethod.upiId}` : c.paymentMethod?.bankAccountNumber ? `Bank: ${c.paymentMethod.bankName}` : 'Not linked yet'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[9px] font-bold text-[#8A8A8A] block">UNPAID BALANCE</span>
                                  <span className="text-[#D7FF3F] font-mono font-bold">${c.unpaidBalanceUsd?.toFixed(2) || '0.00'} USD</span>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="pt-1 flex flex-wrap gap-2 justify-end items-center">
                                {!isApproved ? (
                                  <button
                                    onClick={() => handleMonetizationAction(c.uid, 'Approved', 'Approved with 100% eligibility granted by Admin Console')}
                                    disabled={isProcessing}
                                    className="px-4 py-2 bg-[#D7FF3F] text-black text-xs font-black uppercase rounded-xl hover:bg-[#cbf732] cursor-pointer transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-md"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Approve (Grant 100% All 5 Eligibility & Start Live Earnings)</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleMonetizationAction(c.uid, 'Paused', 'Monetization paused by Admin')}
                                    disabled={isProcessing}
                                    className="px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold uppercase rounded-xl hover:bg-amber-500/20 cursor-pointer transition-all disabled:opacity-50"
                                  >
                                    Pause Monetization
                                  </button>
                                )}

                                {c.monetizationStatus !== 'Suspended' ? (
                                  <button
                                    onClick={() => handleMonetizationAction(c.uid, 'Suspended', 'Suspended by Admin')}
                                    disabled={isProcessing}
                                    className="px-3 py-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-bold uppercase rounded-xl hover:bg-rose-500/20 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
                                  >
                                    <Ban className="w-3 h-3" />
                                    <span>Suspend</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleMonetizationAction(c.uid, 'In Progress', 'Reinstated by Admin')}
                                    disabled={isProcessing}
                                    className="px-3 py-1.5 bg-neutral-700 text-white text-xs font-bold uppercase rounded-xl hover:bg-neutral-600 cursor-pointer transition-all disabled:opacity-50"
                                  >
                                    Reset to In Progress
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            )}
            
            {/* PAYOUTS TAB */}
            {activeTab === 'payouts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-[#A0A0A0] uppercase tracking-wider">
                    Creator Withdrawal Requests
                  </h3>
                  <button 
                    onClick={fetchPayouts}
                    className="text-xs text-[#D7FF3F] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>

                {loadingPayouts ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">Loading payouts...</div>
                ) : payouts.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">No payout requests found.</div>
                ) : (
                  <div className="space-y-3">
                    {payouts.map((p) => (
                      <div key={p.id} className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2C3222] pb-3">
                          <div>
                            <span className="text-xs font-mono font-bold text-white block">Creator ID: {p.creatorId}</span>
                            <span className="text-[10px] text-[#8A8A8A]">Requested: {new Date(p.requestedAt).toLocaleString()}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-[#D7FF3F] font-mono">${p.amountUsd?.toFixed(2)} USD</span>
                            <span className="text-xs text-white font-bold">(≈ ₹{p.amountInrApprox?.toLocaleString()} INR)</span>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' :
                              p.status === 'rejected' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                            }`}>
                              {p.status}
                            </span>
                          </div>
                        </div>

                        {/* Payment Details */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] bg-[#141414] p-3 rounded-xl border border-[#2C3222]">
                          <div>
                            <span className="text-[9px] font-bold text-[#8A8A8A] block">ACCOUNT HOLDER</span>
                            <span className="text-white font-mono font-bold">{p.paymentMethodSnapshot?.accountHolderName || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-[#8A8A8A] block">BANK & IFSC</span>
                            <span className="text-white font-mono font-bold">{p.paymentMethodSnapshot?.bankName} ({p.paymentMethodSnapshot?.ifscCode})</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-[#8A8A8A] block">UPI & ACC NUMBER</span>
                            <span className="text-[#D7FF3F] font-mono font-bold block">{p.paymentMethodSnapshot?.upiId}</span>
                            <span className="text-white font-mono text-[10px]">Acc: {p.paymentMethodSnapshot?.bankAccountNumber}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        {p.status === 'requested' && (
                          <div className="pt-2 flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="Enter Bank Ref / UTR / Transaction ID"
                              value={selectedPayout?.id === p.id ? utrInput : ''}
                              onChange={(e) => {
                                setSelectedPayout(p);
                                setUtrInput(e.target.value);
                              }}
                              className="flex-1 bg-[#141414] border border-[#2C3222] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D7FF3F]"
                            />
                            
                            <div className="flex gap-2">
                              <button
                                onClick={() => handlePayoutAction(p.id, 'mark_paid')}
                                disabled={isProcessingPayout || !utrInput.trim()}
                                className="px-4 py-2 bg-emerald-500 text-black text-xs font-black uppercase rounded-xl hover:bg-emerald-400 cursor-pointer transition-all disabled:opacity-50"
                              >
                                Mark Paid & Release
                              </button>

                              <button
                                onClick={() => handlePayoutAction(p.id, 'reject')}
                                disabled={isProcessingPayout}
                                className="px-4 py-2 bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-black uppercase rounded-xl hover:bg-rose-500/30 cursor-pointer transition-all"
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* REPORTS TAB */}
            {activeTab === 'reports' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {(['pending', 'actioned', 'dismissed', 'all'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setReportFilter(f)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer ${
                          reportFilter === f ? 'bg-[#D7FF3F] text-black' : 'bg-[#2A2A2A] text-[#8A8A8A]'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <button 
                    onClick={fetchReports}
                    className="text-xs text-[#D7FF3F] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>

                {loadingReports ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">Loading report tickets...</div>
                ) : reports.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">No report tickets found for this filter.</div>
                ) : (
                  <div className="space-y-3">
                    {reports.map((r) => (
                      <div key={r.id} className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-white uppercase tracking-wider">
                            Target Type: {r.targetType} ({r.targetId})
                          </span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            r.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                          }`}>
                            {r.status}
                          </span>
                        </div>

                        <div className="text-xs text-[#A0A0A0] bg-[#141414] p-3 rounded-xl border border-[#2C3222] space-y-1">
                          <p><strong className="text-white">Reason:</strong> {r.reason}</p>
                          {r.details && <p><strong className="text-white">Details:</strong> {r.details}</p>}
                          <p className="text-[10px] text-[#8A8A8A] font-mono">Reporter: {r.reporterUid} • Date: {new Date(r.createdAt).toLocaleString()}</p>
                        </div>

                        {r.status === 'pending' && (
                          <div className="pt-2 flex justify-end gap-2">
                            <button
                              onClick={() => handleReportAction(r.id, 'dismiss')}
                              disabled={isProcessingReport}
                              className="px-3 py-1.5 bg-[#2A2A2A] text-white text-xs font-bold rounded-xl hover:bg-[#333] cursor-pointer"
                            >
                              Dismiss Ticket
                            </button>

                            {r.targetType === 'user' && (
                              <button
                                onClick={() => handleReportAction(r.id, 'suspend_user')}
                                disabled={isProcessingReport}
                                className="px-3 py-1.5 bg-rose-500 text-white text-xs font-bold rounded-xl hover:bg-rose-600 cursor-pointer"
                              >
                                Suspend Target User
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* USERS MANAGEMENT TAB (Account Block/Unblock) */}
            {activeTab === 'users' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-black text-[#A0A0A0] uppercase tracking-wider">Account Management</h3>
                    <p className="text-[11px] text-[#707070]">Suspend, ban, warn, or reactivate any user account. All actions are audit-logged.</p>
                  </div>
                  <button
                    onClick={fetchUsers}
                    className="text-xs text-[#D7FF3F] hover:underline flex items-center gap-1 cursor-pointer self-start sm:self-auto"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>

                {/* Search & Status Filter */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8A8A]" />
                    <input
                      type="text"
                      placeholder="Search by username, name, email, or UID..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fetchUsers(); }}
                      className="w-full bg-[#141414] border border-[#2C3222] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-[#555] focus:outline-none focus:border-[#D7FF3F]"
                    />
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    {(['all', 'active', 'suspended', 'banned', 'warned', 'blocked'] as const).map(st => (
                      <button
                        key={st}
                        onClick={() => setUserStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap cursor-pointer transition-all ${
                          userStatusFilter === st ? 'bg-[#D7FF3F] text-black' : 'bg-[#2A2A2A] text-[#8A8A8A] hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-[#666]">Total registered users: {usersTotalCount}</p>

                {/* Users List */}
                {loadingUsers ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">Loading users...</div>
                ) : adminUsers.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">No users found matching current filter.</div>
                ) : (
                  <div className="space-y-3">
                    {adminUsers.map((u) => {
                      const isSuspended = u.accountStatus === 'suspended';
                      const isBanned = u.accountStatus === 'banned';
                      const isBlocked = isSuspended || isBanned;
                      const isProcessing = processingUser === u.uid;

                      return (
                        <div key={u.uid} className={`bg-[#1A1A1A] border p-4 rounded-2xl space-y-3 ${isBlocked ? 'border-rose-500/40' : 'border-[#2C3222]'}`}>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2C3222] pb-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-[#2A2A2A] overflow-hidden border border-[#333] flex items-center justify-center shrink-0">
                                {u.avatarUrl ? (
                                  <img src={u.avatarUrl} alt={u.displayName} className="w-full h-full object-cover" />
                                ) : (
                                  <User className="w-5 h-5 text-[#888]" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-black text-white truncate">{u.displayName}</span>
                                  <span className="text-xs text-[#8A8A8A]">@{u.username}</span>
                                  {isBlocked && (
                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                      isBanned ? 'bg-rose-500 text-white' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                    }`}>
                                      {isBanned ? 'BANNED' : 'SUSPENDED'}
                                    </span>
                                  )}
                                  {u.hasWarning && !isBlocked && (
                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                      WARNED
                                    </span>
                                  )}
                                </div>
                                {u.email && (
                                  <span className="text-[10px] text-[#666] flex items-center gap-1 truncate"><Mail className="w-3 h-3 inline" /> {u.email}</span>
                                )}
                                <span className="text-[10px] text-[#666] font-mono block truncate">UID: {u.uid}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                              <span className="text-xs text-[#A0A0A0] font-bold">{u.followersCount || 0} followers</span>
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider bg-neutral-500/10 text-neutral-400 border border-neutral-500/30">
                                {u.monetizationStatus || 'In Progress'}
                              </span>
                            </div>
                          </div>

                          {/* Moderation info */}
                          {(isBlocked || u.hasWarning) && (
                            <div className="bg-[#141414] border border-[#2C3222] p-3 rounded-xl text-[11px] space-y-1">
                              {isBlocked && (
                                <p className="text-rose-400"><strong>Blocked:</strong> {u.suspendedReason || 'No reason recorded'} {u.suspendedAt ? `• ${new Date(u.suspendedAt).toLocaleDateString()}` : ''}</p>
                              )}
                              {u.hasWarning && (
                                <p className="text-amber-400"><strong>Warning:</strong> {u.warningMessage || 'Active warning on account'}</p>
                              )}
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="pt-1 flex flex-wrap gap-2 justify-end items-center">
                            {!isBlocked ? (
                              <>
                                <button
                                  onClick={() => { setUserActionModal({ user: u, action: 'warn' }); setUserActionNote(''); }}
                                  disabled={isProcessing}
                                  className="px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold uppercase rounded-xl hover:bg-amber-500/20 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
                                >
                                  <AlertOctagon className="w-3 h-3" />
                                  <span>Warn</span>
                                </button>
                                <button
                                  onClick={() => { setUserActionModal({ user: u, action: 'suspend' }); setUserActionNote(''); }}
                                  disabled={isProcessing}
                                  className="px-3 py-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-bold uppercase rounded-xl hover:bg-rose-500/20 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
                                >
                                  <Ban className="w-3 h-3" />
                                  <span>Suspend</span>
                                </button>
                                <button
                                  onClick={() => { setUserActionModal({ user: u, action: 'ban' }); setUserActionNote(''); }}
                                  disabled={isProcessing}
                                  className="px-3 py-1.5 bg-rose-500 text-white text-xs font-black uppercase rounded-xl hover:bg-rose-600 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
                                >
                                  <Ban className="w-3 h-3" />
                                  <span>Ban</span>
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => { setUserActionModal({ user: u, action: 'reactivate' }); setUserActionNote(''); }}
                                disabled={isProcessing}
                                className="px-4 py-2 bg-[#D7FF3F] text-black text-xs font-black uppercase rounded-xl hover:bg-[#cbf732] cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-md"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Reactivate Account</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* MONETIZATION REPORT TAB */}
            {activeTab === 'monreport' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-black text-[#A0A0A0] uppercase tracking-wider">Platform Monetization Report</h3>
                    {monReport?.monthKey && <p className="text-[11px] text-[#707070]">Reporting month: {monReport.monthKey}</p>}
                  </div>
                  <button
                    onClick={fetchMonReport}
                    className="text-xs text-[#D7FF3F] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>

                {loadingMonReport ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">Building report...</div>
                ) : !monReport ? (
                  <div className="py-12 text-center text-xs text-[#8A8A8A]">No report data available. Click Refresh to load.</div>
                ) : (
                  <>
                    {/* Totals Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl">
                        <span className="text-[9px] font-black text-[#8A8A8A] uppercase tracking-wider block">Verified Views (This Month)</span>
                        <span className="text-2xl font-black text-white font-mono">{monReport.totals?.totalViews ?? 0}</span>
                      </div>
                      <div className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl">
                        <span className="text-[9px] font-black text-[#8A8A8A] uppercase tracking-wider block">Total Creator Earnings</span>
                        <span className="text-2xl font-black text-[#D7FF3F] font-mono">${monReport.totals?.totalEarningsUsd?.toFixed(2) ?? '0.00'}</span>
                        <span className="text-[10px] text-[#8A8A8A] block">≈ ₹{monReport.totals?.totalEarningsInr?.toLocaleString() ?? 0}</span>
                      </div>
                      <div className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl">
                        <span className="text-[9px] font-black text-[#8A8A8A] uppercase tracking-wider block">Pending Payouts</span>
                        <span className="text-2xl font-black text-amber-400 font-mono">${monReport.totals?.pendingPayoutUsd?.toFixed(2) ?? '0.00'}</span>
                        <span className="text-[10px] text-[#8A8A8A] block">{monReport.totals?.pendingPayoutCount ?? 0} requests</span>
                      </div>
                      <div className="bg-[#1A1A1A] border border-[#2C3222] p-4 rounded-2xl">
                        <span className="text-[9px] font-black text-[#8A8A8A] uppercase tracking-wider block">Paid Out (All Time)</span>
                        <span className="text-2xl font-black text-emerald-400 font-mono">${monReport.totals?.paidPayoutUsd?.toFixed(2) ?? '0.00'}</span>
                        <span className="text-[10px] text-[#8A8A8A] block">{monReport.totals?.paidPayoutCount ?? 0} payouts</span>
                      </div>
                    </div>

                    <p className="text-[10px] text-[#666]">Earning rule: ₹40 per complete 1,000 verified views per source (profile / story / chat / group) • $500 monthly cap per creator</p>

                    {/* Per-Creator Table */}
                    {monReport.creators?.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#8A8A8A]">No verified views recorded this month yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {monReport.creators.map((c: any) => (
                          <div key={c.uid} className="bg-[#1A1A1A] border border-[#2C3222] p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-[#2A2A2A] overflow-hidden border border-[#333] flex items-center justify-center shrink-0">
                                {c.avatarUrl ? (
                                  <img src={c.avatarUrl} alt={c.displayName} className="w-full h-full object-cover" />
                                ) : (
                                  <User className="w-4 h-4 text-[#888]" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm font-black text-white block truncate">{c.displayName}</span>
                                <span className="text-[10px] text-[#8A8A8A]">@{c.username}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
                              <span className="px-2 py-1 rounded-lg bg-[#141414] border border-[#2C3222] text-[#A0A0A0] flex items-center gap-1" title="Profile views">
                                <Eye className="w-3 h-3" /> {c.profileViews}
                              </span>
                              <span className="px-2 py-1 rounded-lg bg-[#141414] border border-[#2C3222] text-[#A0A0A0] flex items-center gap-1" title="Story views">
                                <Image className="w-3 h-3" /> {c.storyViews}
                              </span>
                              <span className="px-2 py-1 rounded-lg bg-[#141414] border border-[#2C3222] text-[#A0A0A0] flex items-center gap-1" title="Chat views">
                                <MessageSquare className="w-3 h-3" /> {c.chatViews}
                              </span>
                              <span className="px-2 py-1 rounded-lg bg-[#141414] border border-[#2C3222] text-[#A0A0A0] flex items-center gap-1" title="Group views">
                                <Users className="w-3 h-3" /> {c.groupViews}
                              </span>
                              <span className="px-2 py-1 rounded-lg bg-[#10150c] border border-[#3E5C1B] text-[#D7FF3F] font-black">
                                ${c.earningsUsd?.toFixed(2)}
                              </span>
                              {c.payoutStatus && (
                                <span className={`px-2 py-1 rounded-lg uppercase font-black ${
                                  c.payoutStatus === 'rejected' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                                }`}>
                                  {c.payoutStatus}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* User Action Confirmation Modal */}
          {userActionModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#141414] border border-[#2C3222] rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                    userActionModal.action === 'reactivate' ? 'bg-[#D7FF3F]/10 text-[#D7FF3F]' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {userActionModal.action === 'reactivate' ? <RotateCcw className="w-5 h-5" /> : <AlertOctagon className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      {userActionModal.action === 'suspend' && 'Suspend Account?'}
                      {userActionModal.action === 'ban' && 'Permanently Ban Account?'}
                      {userActionModal.action === 'reactivate' && 'Reactivate Account?'}
                      {userActionModal.action === 'warn' && 'Issue Warning?'}
                    </h3>
                    <p className="text-[11px] text-[#8A8A8A]">
                      {userActionModal.user.displayName} (@{userActionModal.user.username})
                    </p>
                  </div>
                </div>

                <p className="text-xs text-[#A0A0A0] bg-[#1A1A1A] border border-[#2C3222] p-3 rounded-xl">
                  {userActionModal.action === 'suspend' && 'The user will be logged out and unable to log in until reactivated. Their monetization will be suspended.'}
                  {userActionModal.action === 'ban' && 'This is permanent. The user will be blocked from the app. Their monetization will be suspended.'}
                  {userActionModal.action === 'reactivate' && 'The user will regain full access. Monetization will be restored unless it was separately suspended.'}
                  {userActionModal.action === 'warn' && 'A warning badge and message will be added to their account.'}
                </p>

                <textarea
                  placeholder={userActionModal.action === 'warn' ? 'Warning message (optional)...' : 'Reason / note for audit log (optional)...'}
                  value={userActionNote}
                  onChange={(e) => setUserActionNote(e.target.value)}
                  rows={3}
                  className="w-full bg-[#1A1A1A] border border-[#2C3222] rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#555] focus:outline-none focus:border-[#D7FF3F] resize-none"
                />

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setUserActionModal(null); setUserActionNote(''); }}
                    className="px-4 py-2 bg-[#2A2A2A] text-white text-xs font-bold rounded-xl hover:bg-[#333] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUserAction}
                    disabled={!!processingUser}
                    className={`px-4 py-2 text-xs font-black uppercase rounded-xl cursor-pointer transition-all disabled:opacity-50 ${
                      userActionModal.action === 'reactivate'
                        ? 'bg-[#D7FF3F] text-black hover:bg-[#cbf732]'
                        : userActionModal.action === 'warn'
                        ? 'bg-amber-500 text-black hover:bg-amber-400'
                        : 'bg-rose-500 text-white hover:bg-rose-600'
                    }`}
                  >
                    {processingUser ? 'Processing...' : 'Confirm'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
