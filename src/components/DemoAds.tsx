import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Coffee, Gift, Dumbbell, Film, ArrowRight, X, ShieldCheck, ShoppingBag, Check } from 'lucide-react';

export type AdMode = 'demo' | 'live';

export const AD_MODE: AdMode = 'live';

export interface NativeAd {
  id: string;
  brand: string;
  logo: string;
  headline: string;
  subtext: string;
  mediaUrl: string;
  ctaText: string;
  couponCode: string;
  offerDetail: string;
  colorTheme: string; // Hex code or tailwind style
}

export interface StoryAd {
  id: string;
  brand: string;
  logo: string;
  mediaUrl: string;
  caption: string;
  ctaText: string;
  couponCode: string;
  colorTheme: string;
}

export const NATIVE_ADS: NativeAd[] = [
  {
    id: 'ad-blue-tokai',
    brand: 'Blue Tokai Coffee',
    logo: '☕',
    headline: 'Chai & Coffee Handshake Meetup! ☕✨',
    subtext: 'Meet your matches at your nearest Blue Tokai outlet. Use special Aura companion pass for Buy 1 Get 1 on all specialty pour-overs.',
    mediaUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=500&q=80',
    ctaText: 'Claim Free Companion Pass 🎟️',
    couponCode: 'AURATOKAI50',
    offerDetail: 'Buy 1 Get 1 on all Speciality Roasts across Bangalore, Delhi, Pune, and Mumbai outlets.',
    colorTheme: '#0F2C59'
  },
  {
    id: 'ad-zomato',
    brand: 'Zomato Live',
    logo: '🍽️',
    headline: 'First Date Dinner Vouchers! 🍛❤️',
    subtext: 'Skip the "where should we eat" debate. Get an exclusive 50% discount voucher up to ₹500 at India\'s top romantic aesthetic cafes.',
    mediaUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=500&q=80',
    ctaText: 'Unlock 50% Dinner Voucher 🍕',
    couponCode: 'AURAFEAST',
    offerDetail: 'Valid on dining out reservations with matched partners at premium cafes.',
    colorTheme: '#CB202D'
  },
  {
    id: 'ad-cultfit',
    brand: 'cult.fit',
    logo: '💪',
    headline: 'Active Gym/Yoga Fit-Dates! 🧘‍♀️🚴‍♀️',
    subtext: 'Ditch the conventional dinners. Book a joint premium workout, spin, or yoga class. 2-for-1 passes available today on Aura.',
    mediaUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=500&q=80',
    ctaText: 'Get Workout Date Pass 🥊',
    couponCode: 'AURACULT',
    offerDetail: 'Get access to collaborative workout sessions at premium cult.fit studios.',
    colorTheme: '#000000'
  },
  {
    id: 'ad-bookmyshow',
    brand: 'BookMyShow',
    logo: '🎟️',
    headline: 'Experience Music & Art Live! 🎵🎸',
    subtext: 'BMS exclusive Aura Spotlight: Buy tickets to any upcoming concert or standup comedy, and get the second ticket free!',
    mediaUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=500&q=80',
    ctaText: 'Get 1-for-1 Concert Pass 🎫',
    couponCode: 'AURASHOW',
    offerDetail: '1-for-1 tickets on all standard standup shows and acoustic indie music gigs.',
    colorTheme: '#EC5E7E'
  },
  {
    id: 'ad-dunzo',
    brand: 'Dunzo Daily',
    logo: '📦',
    headline: 'Send A Cute Care Package! 📦🌸',
    subtext: 'Match had a long day at the studio? Instantly send a curated care package containing fresh tea bags & artisanal chocolates in 19 mins!',
    mediaUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=500&q=80',
    ctaText: 'Send Care Package (₹100 Off) 🎁',
    couponCode: 'AURADUNZO',
    offerDetail: 'Free delivery + ₹100 flat discount on your partner care packages.',
    colorTheme: '#00BFA5'
  }
];

export const STORY_ADS: StoryAd[] = [
  {
    id: 'story-ad-starbucks',
    brand: 'Tata Starbucks India',
    logo: '☕',
    mediaUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80',
    caption: 'Nothing builds connections better than a warm cup of Starbucks Cappuccino. Share a table, swap stories. Buy 1 get 1 free pour-overs today! 💚',
    ctaText: 'Starbucks 1-on-1 Pass ☕',
    couponCode: 'STARBUCKS1FOR1',
    colorTheme: '#00704A'
  },
  {
    id: 'story-ad-bumblehive',
    brand: 'Aura Delhi NCR Lounge',
    logo: '✨',
    mediaUrl: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=400&q=80',
    caption: 'Exclusive Delhi Aura Creative Meetup hosted near Hawa Mahal. Meet fellow architects, painters & curators.',
    ctaText: 'RSVP Invite Only 🏰',
    couponCode: 'DELHICREATIVE',
    colorTheme: '#F4B400'
  }
];

export function getNativeAdCreative(): NativeAd[] {
  return NATIVE_ADS;
}

export function getStoryAdCreative(): StoryAd[] {
  return STORY_ADS;
}

// ---------------- AD LANDING DETAIL POPUP ----------------
interface AdDetailPopupProps {
  ad: NativeAd | StoryAd;
  onClose: () => void;
}

export function AdDetailPopup({ ad, onClose }: AdDetailPopupProps) {
  const isNative = 'headline' in ad;
  const coupon = ad.couponCode;
  const brandName = ad.brand;
  const color = ad.colorTheme;
  const mediaUrl = ad.mediaUrl;
  
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(coupon);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[150] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 30 }}
        className="w-full max-w-md bg-[#141414] rounded-[2.5rem] overflow-hidden shadow-2xl border border-[#2A2A2A] flex flex-col relative text-left"
      >
        {/* Banner Image */}
        <div className="h-44 w-full relative">
          <img src={mediaUrl} alt={brandName} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-black/30 to-transparent" />
          
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white cursor-pointer backdrop-blur-sm transition-all border border-[#2A2A2A] outline-none"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Logo badge */}
          <div className="absolute bottom-4 left-6 flex items-center gap-2.5">
            <div className="w-10 h-10 bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl shadow flex items-center justify-center text-xl">
              {ad.logo}
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#E5FF3B] bg-black/60 px-2 py-0.5 rounded border border-[#2A2A2A] backdrop-blur-xs">SPONSORED PROMO</span>
              <h3 className="text-sm font-black text-white tracking-tight">{brandName}</h3>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <h4 className="text-base font-extrabold text-white tracking-tight leading-snug">
              {isNative ? (ad as NativeAd).headline : `Aura Spotlights: ${brandName}`}
            </h4>
            <p className="text-xs text-[#A1A1AA] font-medium leading-relaxed">
              {isNative ? (ad as NativeAd).subtext : (ad as StoryAd).caption}
            </p>
          </div>

          {/* Offer & Code container */}
          <div className="bg-[#1E1E1E] border border-[#2A2A2A] rounded-3xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Gift className="w-5 h-5 text-[#E5FF3B] mt-0.5" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-[#A1A1AA]">EXCLUSIVITY REWARD</p>
                <p className="text-xs font-bold text-white leading-normal">
                  {isNative ? (ad as NativeAd).offerDetail : "Special 1-on-1 meetup companion pass applied."}
                </p>
              </div>
            </div>

            <div className="border-t border-[#2A2A2A] pt-4 flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#A1A1AA]">Coupon Code</p>
                <code className="text-sm font-black text-[#E5FF3B] select-all font-mono tracking-wider">{coupon}</code>
              </div>
              <button
                onClick={handleCopy}
                className="h-10 px-5 bg-[#E5FF3B] text-black text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-sm hover:bg-[#d8f030] active:scale-95 transition-all cursor-pointer border-none outline-none"
              >
                {copied ? "Copied! ✓" : "Copy Code"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 rounded-2xl p-4">
            <ShieldCheck className="w-5 h-5 text-[#E5FF3B] shrink-0" />
            <p className="text-[11px] font-semibold text-[#E5FF3B] leading-relaxed">
              This sponsor is vetted by Aura. Tapping code automatically copies discount and unlocks reservation pathways inside the chat thread.
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-full h-12 bg-white text-black hover:bg-zinc-200 rounded-full text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all cursor-pointer border-none outline-none"
          >
            <span>Return to Match Loop</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
