import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Globe, Users, X, Check, Sparkles } from "lucide-react";

interface CreateStoryModalProps {
  isOpen: boolean;
  imageSrc: string;
  onCancel: () => void;
  onSave: (imageSrc: string, caption: string, audience: "everyone" | "followers") => void;
}

export default function CreateStoryModal({
  isOpen,
  imageSrc,
  onCancel,
  onSave,
}: CreateStoryModalProps) {
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<"everyone" | "followers">("everyone");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setCaption("");
      setAudience("everyone");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle backdrop click to close the popup as requested by "click on empty space to close any popup"
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onCancel();
    }
  };

  const handleSubmit = () => {
    onSave(imageSrc, caption, audience);
  };

  return (
    <AnimatePresence>
      <div
        onClick={handleBackdropClick}
        className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 md:p-6 select-none"
      >
        <motion.div
          ref={modalRef}
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="w-full max-w-lg bg-[#141414] rounded-[2.5rem] border border-[#2A2A2A] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div
            className="px-6 pb-5 border-b border-[#2A2A2A] flex items-center justify-between"
            style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#E5FF3B]/10 text-[#E5FF3B] flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Configure Story</h3>
                <p className="text-[10px] text-[#A1A1AA] font-bold uppercase tracking-wider">Layout inspiration</p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="w-8 h-8 rounded-full bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#A1A1AA] hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Direct Image Preview - Crop Removed as per request */}
            <div className="relative aspect-[4/5] w-full rounded-2xl overflow-hidden border border-[#2A2A2A] bg-[#1E1E1E] flex items-center justify-center">
              <img
                src={imageSrc}
                alt="Story draft preview"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-3 left-3 px-3 py-1 bg-black/80 backdrop-blur-md text-white rounded-full text-[9px] font-black uppercase tracking-wider border border-[#2A2A2A]">
                Full Image
              </div>
            </div>

            {/* Adjust Caption */}
            <div className="space-y-2 text-left">
              <label className="text-xs font-black text-[#A1A1AA] uppercase tracking-wider">
                Story Caption
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write a custom creative caption overlay... e.g. Sketching blueprints in Tribeca 📐✨"
                className="w-full h-24 p-4 border border-[#2A2A2A] focus:border-[#E5FF3B] focus:ring-1 focus:ring-[#E5FF3B] bg-[#1E1E1E] rounded-2xl text-xs text-white font-medium placeholder-[#A1A1AA]/50 outline-none resize-none transition-all"
              />
            </div>

            {/* Privacy setting: Everyone or Only followers */}
            <div className="space-y-2.5 text-left">
              <label className="text-xs font-black text-[#A1A1AA] uppercase tracking-wider">
                Who can see this story?
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAudience("everyone")}
                  className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                    audience === "everyone"
                      ? "border-[#E5FF3B] bg-[#E5FF3B]/10 text-[#E5FF3B]"
                      : "border-[#2A2A2A] hover:border-[#3A3A3A] bg-[#1E1E1E] text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  <Globe className={`w-4 h-4 mt-0.5 ${audience === "everyone" ? "text-[#E5FF3B]" : "text-[#A1A1AA]"}`} />
                  <div>
                    <p className="text-xs font-bold leading-tight">Everyone</p>
                    <p className="text-[9px] text-[#A1A1AA] font-semibold mt-0.5 leading-normal">
                      All nearby creators in Tribeca map can view
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAudience("followers")}
                  className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                    audience === "followers"
                      ? "border-[#E5FF3B] bg-[#E5FF3B]/10 text-[#E5FF3B]"
                      : "border-[#2A2A2A] hover:border-[#3A3A3A] bg-[#1E1E1E] text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  <Users className={`w-4 h-4 mt-0.5 ${audience === "followers" ? "text-[#E5FF3B]" : "text-[#A1A1AA]"}`} />
                  <div>
                    <p className="text-xs font-bold leading-tight">Followers Only</p>
                    <p className="text-[9px] text-[#A1A1AA] font-semibold mt-0.5 leading-normal">
                      Only creators following you can view
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="px-6 py-5 bg-[#141414] border-t border-[#2A2A2A] flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-11 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#A1A1AA] hover:text-white border border-[#2A2A2A] rounded-full text-xs font-bold transition-all cursor-pointer"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="flex-1 h-11 bg-[#E5FF3B] hover:bg-[#d8f030] text-black rounded-full text-xs font-black uppercase tracking-wider shadow-md active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Apply & Publish</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
