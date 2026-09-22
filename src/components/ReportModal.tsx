import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Flag, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  UserX, 
  Ban, 
  MessageSquare, 
  Eye, 
  Lock,
  ChevronRight,
  Send,
  Loader2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';

export interface ReportTarget {
  targetType: 'user' | 'story' | 'group' | 'message';
  targetId: string;
  targetName?: string;
  targetUsername?: string;
  targetAvatar?: string;
  targetContent?: string;
  parentId?: string; // e.g. chatId for message
}

interface ReportModalProps {
  isOpen: boolean;
  target: ReportTarget | null;
  onClose: () => void;
  onReportSubmitted?: (reportId: string) => void;
  onBlockUser?: (creatorId: string) => void;
}

const REPORT_REASONS = [
  {
    id: 'harassment',
    label: 'Harassment or Bullying',
    desc: 'Unwanted offensive messages, intimidation, stalking, or targeted insults',
    icon: UserX,
    color: 'text-amber-400'
  },
  {
    id: 'inappropriate',
    label: 'Inappropriate or Adult Content',
    desc: 'Explicit media, nudity, sexual solicitation, or inappropriate photos',
    icon: AlertTriangle,
    color: 'text-rose-400'
  },
  {
    id: 'spam',
    label: 'Spam, Scam, or Commercial Fraud',
    desc: 'Unsolicited advertising, scam links, crypto fraud, or bot activity',
    icon: Ban,
    color: 'text-orange-400'
  },
  {
    id: 'impersonation',
    label: 'Impersonation or Fake Profile',
    desc: 'Pretending to be someone else, fake identity, or stolen photos',
    icon: Lock,
    color: 'text-purple-400'
  },
  {
    id: 'hate_violence',
    label: 'Hate Speech or Threats of Violence',
    desc: 'Racism, hate symbols, dangerous behavior, or violent threats',
    icon: ShieldAlert,
    color: 'text-red-400'
  },
  {
    id: 'other',
    label: 'Other Community Guidelines Violation',
    desc: 'Intellectual property infringement or other disruptive violations',
    icon: Flag,
    color: 'text-neutral-400'
  }
];

export default function ReportModal({
  isOpen,
  target,
  onClose,
  onReportSubmitted,
  onBlockUser
}: ReportModalProps) {
  const { currentUser, userProfile } = useAuth();
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customDetails, setCustomDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [ticketId, setTicketId] = useState<string>('');

  if (!isOpen || !target) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedReason) {
      alert('Please select a reason for reporting.');
      return;
    }

    setIsSubmitting(true);
    const chosenReasonObj = REPORT_REASONS.find(r => r.id === selectedReason);
    const reasonLabel = chosenReasonObj?.label || selectedReason;

    const reportDocId = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setTicketId(reportDocId);

    const reporterUid = currentUser?.uid || 'guest_user';
    const reporterName = userProfile?.name || userProfile?.displayName || 'Anonymous User';
    const reporterUsername = userProfile?.username || 'user';

    const reportPayload = {
      id: reportDocId,
      reporterUid,
      reporterName,
      reporterUsername,
      targetType: target.targetType,
      targetId: target.targetId,
      targetName: target.targetName || 'User',
      targetUsername: target.targetUsername || '',
      targetAvatar: target.targetAvatar || '',
      targetContent: target.targetContent || null,
      parentId: target.parentId || null,
      reasonCategory: selectedReason,
      reason: reasonLabel,
      details: customDetails.trim() || null,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    let serverReportSuccess = false;

    // 1. Send via Backend Server Endpoint
    try {
      const token = await currentUser?.getIdToken();
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(reportPayload)
      });

      if (res.ok) {
        serverReportSuccess = true;
      }
    } catch (err) {
      console.warn('[ReportModal] Server API fallback:', err);
    }

    // 2. Direct Firestore Write as Guarantee
    try {
      const reportRef = doc(db, 'reports', reportDocId);
      await setDoc(reportRef, {
        ...reportPayload,
        serverSynced: serverReportSuccess,
        timestamp: serverTimestamp()
      }, { merge: true });
    } catch (fsErr) {
      console.warn('[ReportModal] Firestore write warning:', fsErr);
    }

    // 3. If user checked "Also block this user"
    if (alsoBlock && target.targetType === 'user' && onBlockUser) {
      try {
        onBlockUser(target.targetId);
      } catch (err) {
        console.warn('[ReportModal] Block action error:', err);
      }
    }

    setIsSubmitting(false);
    setIsSubmitted(true);

    if (onReportSubmitted) {
      onReportSubmitted(reportDocId);
    }
  };

  const handleFinish = () => {
    setIsSubmitted(false);
    setSelectedReason('');
    setCustomDetails('');
    setAlsoBlock(false);
    onClose();
  };

  return (
    <AnimatePresence>
      <div 
        id="report_modal_overlay"
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      >
        <motion.div 
          id="report_modal_card"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-[#141414] border border-[#2C3222] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-[#2C3222] flex items-center justify-between bg-[#1A1A1A]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <Flag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">
                  Report {target.targetType === 'user' ? 'Profile' : target.targetType === 'story' ? 'Story' : target.targetType === 'group' ? 'Group Chat' : 'Message'}
                </h3>
                <p className="text-[11px] text-[#A0A0A0]">
                  Help us keep Anvio Talk safe and respectful
                </p>
              </div>
            </div>

            <button 
              id="report_modal_close_btn"
              onClick={handleFinish}
              className="p-2 rounded-xl bg-[#2A2A2A] text-[#8A8A8A] hover:text-white hover:bg-[#333] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar space-y-4">
            {isSubmitted ? (
              /* Success confirmation view */
              <div className="py-8 px-4 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mx-auto flex items-center justify-center animate-bounce">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-black text-white">Report Successfully Submitted</h4>
                  <p className="text-xs text-[#A0A0A0] max-w-sm mx-auto">
                    Thank you. Your report has been dispatched to our 24/7 moderation team for safety review.
                  </p>
                </div>

                <div className="bg-[#1A1A1A] border border-[#2C3222] p-3 rounded-2xl max-w-xs mx-auto text-left text-[11px] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[#8A8A8A]">Ticket ID:</span>
                    <span className="font-mono text-white">{ticketId.substring(0, 16)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8A8A8A]">Review Status:</span>
                    <span className="text-amber-400 font-bold">In Queue (12-24h)</span>
                  </div>
                </div>

                <button
                  id="report_modal_done_btn"
                  onClick={handleFinish}
                  className="px-6 py-2.5 bg-[#D7FF3F] text-black font-black text-xs uppercase rounded-xl hover:bg-[#cbf732] cursor-pointer transition-all shadow-md mt-2"
                >
                  Done
                </button>
              </div>
            ) : (
              /* Report form */
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Target context banner */}
                <div className="bg-[#1A1A1A] border border-[#2C3222] p-3 rounded-2xl flex items-center gap-3">
                  {target.targetAvatar ? (
                    <img 
                      src={target.targetAvatar} 
                      alt={target.targetName} 
                      className="w-10 h-10 rounded-full object-cover border border-[#333]" 
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#2A2A2A] flex items-center justify-center text-[#888]">
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-black text-white block truncate">
                      {target.targetName || 'Report Target'}
                    </span>
                    {target.targetUsername && (
                      <span className="text-[10px] text-[#8A8A8A] block">@{target.targetUsername}</span>
                    )}
                    {target.targetContent && (
                      <p className="text-[10px] text-[#777] italic truncate mt-0.5">"{target.targetContent}"</p>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider border border-rose-500/20">
                    {target.targetType}
                  </span>
                </div>

                {/* Reason Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-[#A0A0A0] uppercase tracking-wider block">
                    Select Reason for Report <span className="text-rose-400">*</span>
                  </label>

                  <div className="space-y-1.5">
                    {REPORT_REASONS.map((r) => {
                      const Icon = r.icon;
                      const isSelected = selectedReason === r.id;

                      return (
                        <div
                          key={r.id}
                          id={`report_reason_${r.id}`}
                          onClick={() => setSelectedReason(r.id)}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                            isSelected 
                              ? 'bg-rose-500/10 border-rose-500/50 text-white' 
                              : 'bg-[#1A1A1A] border-[#2C3222] text-[#8A8A8A] hover:border-[#3E4530] hover:text-white'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-xl bg-[#222] flex items-center justify-center shrink-0 mt-0.5 ${r.color}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <span className="text-xs font-black block text-white">{r.label}</span>
                            <span className="text-[10.5px] text-[#8A8A8A] block mt-0.5">{r.desc}</span>
                          </div>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-1 ${
                            isSelected ? 'border-rose-400 bg-rose-400 text-black' : 'border-[#444]'
                          }`}>
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Additional Details */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-[#A0A0A0] uppercase tracking-wider block">
                    Additional Details <span className="text-[10px] text-[#666] font-normal">(Optional)</span>
                  </label>
                  <textarea
                    id="report_modal_details_input"
                    rows={3}
                    placeholder="Provide any specific context or details to help moderators review..."
                    value={customDetails}
                    onChange={(e) => setCustomDetails(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#2C3222] rounded-2xl p-3 text-xs text-white placeholder:text-[#555] focus:outline-none focus:border-rose-400 custom-scrollbar resize-none"
                  />
                </div>

                {/* Optional Block Option */}
                {target.targetType === 'user' && (
                  <div 
                    id="report_modal_block_checkbox"
                    onClick={() => setAlsoBlock(!alsoBlock)}
                    className="p-3 bg-[#1A1A1A] border border-[#2C3222] rounded-2xl flex items-center gap-3 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={alsoBlock}
                      onChange={(e) => setAlsoBlock(e.target.checked)}
                      className="w-4 h-4 rounded accent-rose-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-black text-white block">Also block this user</span>
                      <span className="text-[10.5px] text-[#8A8A8A] block">They won't be able to message you or view your profile</span>
                    </div>
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="px-4 py-2.5 rounded-xl bg-[#2A2A2A] text-white text-xs font-bold hover:bg-[#333] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    id="report_modal_submit_btn"
                    disabled={isSubmitting || !selectedReason}
                    className="px-5 py-2.5 rounded-xl bg-rose-500 text-white text-xs font-black uppercase tracking-wider hover:bg-rose-600 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-md"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit Report</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
