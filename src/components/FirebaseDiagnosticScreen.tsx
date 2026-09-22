import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  ShieldAlert, CheckCircle2, XCircle, RefreshCw, Copy, Check, 
  Database, HardDrive, Key, Flame, ArrowRight, ExternalLink,
  Code2, AlertTriangle, Terminal, Info
} from 'lucide-react';
import { FirebaseHealthReport, runFirebaseDiagnostics } from '../utils/firebaseDiagnostics';

interface Props {
  report: FirebaseHealthReport;
  onRefresh: () => void;
  isRetesting?: boolean;
}

export const FirebaseDiagnosticScreen: React.FC<Props> = ({
  report,
  onRefresh,
  isRetesting = false
}) => {
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'issues' | 'schema' | 'rules'>('issues');

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  const getServiceIcon = (service: string) => {
    switch (service) {
      case 'config': return <Key className="w-5 h-5 text-amber-600" />;
      case 'auth': return <Flame className="w-5 h-5 text-orange-600" />;
      case 'firestore': return <Database className="w-5 h-5 text-indigo-600" />;
      case 'storage': return <HardDrive className="w-5 h-5 text-emerald-600" />;
      default: return <Info className="w-5 h-5 text-slate-600" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 md:p-10 font-sans selection:bg-[#854c6f] selection:text-white">
      {/* Background Subtle Gradient Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-rose-600 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-amber-600 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-indigo-600 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-4xl relative z-10 space-y-6">
        {/* Header Badge & Title */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Real Firebase Backend Mode Required</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Firebase Connection & Setup Required
          </h1>
          
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Mock Mode has been permanently disabled. To run Anvio Talk, your real Firebase project (<span className="font-mono text-amber-400 font-semibold">{report.projectId}</span>) requires setup in Firebase Console.
          </p>
        </div>

        {/* Action Header & Retest Button */}
        <div className="bg-[#181a20] border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3 text-left">
            <div className="p-2.5 bg-rose-500/10 rounded-xl text-rose-400 flex-shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {report.criticalErrors.length} Issue{report.criticalErrors.length > 1 ? 's' : ''} Detected
              </h3>
              <p className="text-xs text-slate-400">
                Complete the step-by-step instructions below to connect the live backend.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onRefresh}
              disabled={isRetesting}
              className="w-full sm:w-auto px-5 py-2.5 bg-[#854c6f] hover:bg-[#723e5e] active:scale-95 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-lg shadow-[#854c6f]/20"
            >
              <RefreshCw className={`w-4 h-4 ${isRetesting ? 'animate-spin' : ''}`} />
              <span>{isRetesting ? 'Checking Firebase...' : 'Re-Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('issues')}
            className={`px-4 py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'issues'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Missing Requirements ({report.criticalErrors.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('schema')}
            className={`px-4 py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'schema'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Firestore Collections & Structure</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`px-4 py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'rules'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Security Rules (firestore.rules)</span>
          </button>
        </div>

        {/* Tab 1: Issues & Diagnostic Items */}
        {activeTab === 'issues' && (
          <div className="space-y-4">
            {report.checks.map((check) => (
              <div
                key={check.id}
                className={`bg-[#181a20] border rounded-2xl p-5 text-left transition-all ${
                  check.status === 'error'
                    ? 'border-rose-500/40 bg-rose-950/10'
                    : check.status === 'warning'
                    ? 'border-amber-500/40 bg-amber-950/10'
                    : 'border-emerald-500/20 bg-emerald-950/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-800/80 rounded-xl">
                      {getServiceIcon(check.service)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>{check.title}</span>
                      </h3>
                      <p className="text-xs text-slate-400 font-medium">{check.summary}</p>
                    </div>
                  </div>

                  {check.status === 'success' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Ready</span>
                    </span>
                  ) : check.status === 'error' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-bold rounded-full">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Action Required</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] font-bold rounded-full">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Warning</span>
                    </span>
                  )}
                </div>

                {/* Details & Step by Step Fix */}
                {(check.status === 'error' || check.status === 'warning') && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                    {check.missingRequirement && (
                      <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
                        <p className="text-[11px] font-bold text-rose-300 uppercase tracking-wider">What is missing:</p>
                        <p className="text-xs font-semibold text-rose-200 mt-0.5">{check.missingRequirement}</p>
                      </div>
                    )}

                    {check.whyRequired && (
                      <div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Why it is required:</p>
                        <p className="text-xs text-slate-300 font-medium leading-relaxed mt-0.5">{check.whyRequired}</p>
                      </div>
                    )}

                    {check.fixSteps && check.fixSteps.length > 0 && (
                      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
                        <p className="text-[11px] font-extrabold text-amber-400 uppercase tracking-wider">Exact Steps to Fix:</p>
                        <ol className="list-decimal list-inside space-y-1 text-xs text-slate-300 font-medium">
                          {check.fixSteps.map((step, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Code artifacts if generated */}
                    {check.generatedArtifacts && check.generatedArtifacts.map((art, idx) => (
                      <div key={idx} className="bg-black/50 border border-slate-800 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-mono text-emerald-400 font-bold">{art.title}</p>
                          <button
                            onClick={() => handleCopy(art.code, `${check.id}_${idx}`)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            {copiedIndex === `${check.id}_${idx}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Code</span>
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40 p-2 bg-slate-950 rounded-lg">
                          {art.code}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: Schema */}
        {activeTab === 'schema' && (
          <div className="bg-[#181a20] border border-slate-800 rounded-2xl p-5 text-left space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Required Firestore Collections & Documents</h3>
                <p className="text-xs text-slate-400">Structure expected by the Anvio Talk real-time database SDK.</p>
              </div>
              <button
                onClick={() => handleCopy(FIRESTORE_SCHEMA_TEXT, 'schema_all')}
                className="px-3 py-1.5 bg-[#854c6f] hover:bg-[#723e5e] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                {copiedIndex === 'schema_all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedIndex === 'schema_all' ? 'Copied' : 'Copy Schema'}</span>
              </button>
            </div>

            <pre className="text-xs font-mono text-slate-300 p-4 bg-slate-950 rounded-xl overflow-x-auto max-h-96 leading-relaxed border border-slate-800">
              {FIRESTORE_SCHEMA_TEXT}
            </pre>
          </div>
        )}

        {/* Tab 3: Security Rules */}
        {activeTab === 'rules' && (
          <div className="bg-[#181a20] border border-slate-800 rounded-2xl p-5 text-left space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Firestore Security Rules (firestore.rules)</h3>
                <p className="text-xs text-slate-400">Copy & paste these into your Firebase Console &gt; Firestore &gt; Rules tab.</p>
              </div>
              <a
                href={`https://console.firebase.google.com/project/${report.projectId}/firestore/rules`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <span>Open Rules in Console</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="relative">
              <button
                onClick={() => handleCopy(FIRESTORE_RULES_TEXT, 'rules_all')}
                className="absolute top-3 right-3 px-3 py-1.5 bg-[#854c6f] hover:bg-[#723e5e] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer z-10"
              >
                {copiedIndex === 'rules_all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedIndex === 'rules_all' ? 'Copied' : 'Copy Rules'}</span>
              </button>

              <pre className="text-xs font-mono text-slate-300 p-4 bg-slate-950 rounded-xl overflow-x-auto max-h-96 leading-relaxed border border-slate-800">
                {FIRESTORE_RULES_TEXT}
              </pre>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="text-center pt-2">
          <p className="text-xs text-slate-500 font-medium">
            Anvio Talk &bull; Firebase Diagnostics Engine &bull; Project ID: {report.projectId}
          </p>
        </div>
      </div>
    </div>
  );
};

const FIRESTORE_SCHEMA_TEXT = `// ANVIOTALK FIRESTORE COLLECTION & DOCUMENT SCHEMAS:

1. /users/{userId}
   - uid: string (e.g. "auth_uid_123")
   - username: string (e.g. "alexmercer")
   - displayName: string (e.g. "Alex Mercer")
   - email: string (e.g. "alex@example.com")
   - bio: string
   - specialty: string (e.g. "UI Designer")
   - avatarUrl: string (HTTPS URL)
   - portfolioPhotos: array of string URLs
   - skillTags: array of strings
   - createdAt: timestamp
   - followersCount: number
   - followingCount: number

2. /usernames/{username}
   - uid: string (references userId for unique username checks)

3. /stories/{storyId}
   - authorUid: string
   - authorUsername: string
   - authorName: string
   - authorAvatar: string
   - mediaUrl: string
   - mediaType: string ("image" | "video")
   - caption: string
   - createdAt: timestamp

4. /chats/{chatId}
   - participants: array of string uids
   - lastMessage: string
   - lastUpdated: timestamp

5. /chats/{chatId}/messages/{messageId}
   - senderId: string
   - senderName: string
   - text: string
   - createdAt: timestamp

6. /notifications/{userId}/items/{itemId}
   - type: string ("like" | "follow" | "comment")
   - fromUid: string
   - fromName: string
   - fromAvatar: string
   - createdAt: timestamp
   - read: boolean`;

const FIRESTORE_RULES_TEXT = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    // Users Profiles
    match /users/{userId} {
      allow read: if true;
      allow create, update: if isAuthenticated() && request.auth.uid == userId;
      allow delete: if false;

      match /saved/{savedId} {
        allow read, write: if isAuthenticated() && request.auth.uid == userId;
      }
    }

    // Username reservation
    match /usernames/{username} {
      allow read: if true;
      allow create, update, delete: if isAuthenticated();
    }

    // Stories for today
    match /stories/{storyId} {
      allow read: if true;
      allow create: if isAuthenticated() && request.resource.data.authorUid == request.auth.uid;
      allow update, delete: if isAuthenticated() && resource.data.authorUid == request.auth.uid;
    }

    // Likes on portfolio posts
    match /likes/{likeId} {
      allow read: if true;
      allow create, update: if isAuthenticated() && request.resource.data.uid == request.auth.uid;
      allow delete: if isAuthenticated() && resource.data.uid == request.auth.uid;
    }

    // Follow system
    match /follows/{followId} {
      allow read: if isAuthenticated();
      allow create, update, delete: if isAuthenticated();
    }

    // Chat Rooms and Direct Messages
    match /chats/{chatId} {
      allow read, update, delete: if isAuthenticated() && request.auth.uid in resource.data.participants;
      allow create: if isAuthenticated();

      match /messages/{messageId} {
        allow read, create: if isAuthenticated();
      }
    }

    // User Notifications
    match /notifications/{userId}/items/{itemId} {
      allow read, update, delete: if isAuthenticated() && request.auth.uid == userId;
      allow create: if isAuthenticated();
    }
  }
}`;
