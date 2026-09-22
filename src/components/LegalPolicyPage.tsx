import React from 'react';
import { ArrowLeft, Shield, Scale, Mail, ExternalLink, FileText, CheckCircle2 } from 'lucide-react';
import { LEGAL_POLICIES_DATA, LegalPolicy } from '../data/legalPoliciesData';

interface LegalPolicyPageProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
}

export const LegalPolicyPage: React.FC<LegalPolicyPageProps> = ({
  currentPath,
  onNavigate,
  onClose
}) => {
  // Fall back to privacy policy if route doesn't match
  const policy: LegalPolicy = LEGAL_POLICIES_DATA[currentPath] || LEGAL_POLICIES_DATA['/privacy-policy'];

  const allPolicies = Object.values(LEGAL_POLICIES_DATA);

  return (
    <div className="min-h-screen w-full bg-[#0A0A0A] text-white flex flex-col font-sans select-text overflow-y-auto">
      {/* Top Fixed / Sticky Header */}
      <header className="sticky top-0 z-50 bg-[#121212]/95 backdrop-blur-md border-b border-[#2A2A2A] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#333] flex items-center justify-center text-white transition-all cursor-pointer group"
            title="Return to previous screen"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </button>

          <div className="flex items-center gap-2.5">
            <img
              src="https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png"
              alt="Anvio Talk Logo"
              className="w-7 h-7 object-contain rounded-lg"
            />
            <div>
              <span className="text-sm font-black tracking-wider text-white uppercase block leading-none">
                Anvio Talk
              </span>
              <span className="text-[10px] text-[#A1A1AA] font-semibold">
                Legal & Policy Documentation
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="px-3.5 py-1.5 bg-[#E5FF3B] text-black font-extrabold text-xs rounded-full hover:bg-[#d8f52c] transition-all cursor-pointer shadow-md shadow-[#E5FF3B]/10"
        >
          Return to App
        </button>
      </header>

      {/* Horizontal Policy Switcher Scroll Bar */}
      <nav className="bg-[#141414] border-b border-[#2A2A2A] px-4 py-2.5 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 min-w-max">
          {allPolicies.map((p) => {
            const isActive = p.path === policy.path;
            return (
              <button
                key={p.path}
                type="button"
                onClick={() => onNavigate(p.path)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-[#E5FF3B] text-black shadow-md shadow-[#E5FF3B]/20'
                    : 'bg-[#1F1F1F] text-[#B5B5B5] hover:text-white hover:bg-[#2A2A2A] border border-[#2A2A2A]'
                }`}
              >
                <FileText className={`w-3.5 h-3.5 ${isActive ? 'text-black' : 'text-[#E5FF3B]'}`} />
                <span>{p.title}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:px-6 md:py-12">
        {/* Banner Card */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 mb-8 relative overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#E5FF3B]/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 text-[#E5FF3B] text-xs font-bold mb-3">
              <Scale className="w-3.5 h-3.5" />
              <span>{policy.category}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
              {policy.title}
            </h1>

            <p className="text-xs text-[#A1A1AA] font-semibold mb-4 flex items-center gap-1.5">
              <span>Last Updated:</span>
              <span className="text-white font-bold">{policy.lastUpdated}</span>
              <span>•</span>
              <span>Official Anvio Talk Compliance Record</span>
            </p>

            <div className="p-4 rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A]">
              <p className="text-xs sm:text-sm text-[#D4D4D8] leading-relaxed font-medium">
                {policy.summary}
              </p>
            </div>
          </div>
        </div>

        {/* Policy Sections */}
        <div className="space-y-6">
          {policy.sections.map((section, sIdx) => (
            <section
              key={sIdx}
              className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-7 shadow-lg"
            >
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#E5FF3B]" />
                {section.title}
              </h2>

              <div className="space-y-3">
                {section.content.map((paragraph, pIdx) => (
                  <p key={pIdx} className="text-xs sm:text-sm text-[#B5B5B5] leading-relaxed font-normal">
                    {paragraph}
                  </p>
                ))}
              </div>

              {section.bullets && section.bullets.length > 0 && (
                <ul className="mt-4 space-y-2.5 pl-1">
                  {section.bullets.map((bullet, bIdx) => (
                    <li key={bIdx} className="flex items-start gap-2.5 text-xs sm:text-sm text-[#D4D4D8] leading-relaxed">
                      <CheckCircle2 className="w-4 h-4 text-[#E5FF3B] shrink-0 mt-0.5" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/* Support & Contact Card */}
        <div className="mt-10 bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 rounded-full flex items-center justify-center mx-auto text-[#E5FF3B]">
            <Mail className="w-6 h-6" />
          </div>

          <div>
            <h3 className="text-base font-black text-white">Have questions about this policy?</h3>
            <p className="text-xs text-[#A1A1AA] font-medium mt-1">
              Our legal and support team is available to assist you with compliance or privacy queries.
            </p>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-3 pt-2">
            <a
              href="mailto:support@anviotalk.in"
              className="px-4 py-2 bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#333] text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2"
            >
              <Mail className="w-3.5 h-3.5 text-[#E5FF3B]" /> support@anviotalk.in
            </a>
            <a
              href="mailto:privacy@anviotalk.in"
              className="px-4 py-2 bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#333] text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2"
            >
              <Shield className="w-3.5 h-3.5 text-[#E5FF3B]" /> privacy@anviotalk.in
            </a>
          </div>
        </div>

        {/* Footer info */}
        <footer className="mt-8 mb-12 text-center text-[11px] text-[#A1A1AA] font-medium space-y-2">
          <p>© {new Date().getFullYear()} Anvio Talk Digital Technologies Pvt. Ltd. All rights reserved.</p>
          <p>Designed for location-aware creative connections & compliant under Indian DPDP Act 2023.</p>
        </footer>
      </main>
    </div>
  );
};
