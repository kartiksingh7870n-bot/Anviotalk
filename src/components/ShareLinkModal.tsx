import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Share2, Copy } from 'lucide-react';
import { triggerShare } from '../utils/deeplink';

interface ShareLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  imageUrl?: string;
  shareUrl: string;
}

export default function ShareLinkModal({
  isOpen,
  onClose,
  title,
  description,
  shareUrl,
}: ShareLinkModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      return;
    }

    let isMounted = true;
    triggerShare({ title, text: description, url: shareUrl }).then((success) => {
      if (isMounted) {
        setCopied(true);
        setTimeout(() => {
          if (isMounted) {
            setCopied(false);
            onClose();
          }
        }, 2200);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, shareUrl, title, description, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        onClick={onClose}
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/20 backdrop-blur-[1px] select-none"
      >
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.95 }}
          className="bg-[#1A1A1A] border border-[#2A2A2A] text-white text-xs font-bold px-5 py-3.5 rounded-full shadow-2xl flex items-center gap-2.5 max-w-sm"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-[#E5FF3B]" />
              <span>Link copied to clipboard!</span>
            </>
          ) : (
            <>
              <Share2 className="w-4 h-4 text-[#E5FF3B] animate-pulse" />
              <span>Sharing link...</span>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

