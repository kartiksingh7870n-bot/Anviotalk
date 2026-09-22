import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Sparkles, User, HelpCircle, Layers } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { ONBOARDING_SLIDES } from '../data';

interface WelcomeScreenProps {
  viewport: 'desktop' | 'mobile';
  currentSlide: number;
  onNextSlide: () => void;
  onPrevSlide: () => void;
  onNavigateToLogin: () => void;
  onNavigateToMap: () => void;
}

export default function WelcomeScreen({
  viewport,
  currentSlide,
  onNextSlide,
  onPrevSlide,
  onNavigateToLogin,
  onNavigateToMap
}: WelcomeScreenProps) {
  const { themeMode } = useTheme();

  const slides = ONBOARDING_SLIDES;
  const slide = slides[currentSlide];

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden bg-[#0A0A0A] text-white font-sans select-none"
    >
      <AnimatePresence mode="wait">
        {currentSlide >= 0 && currentSlide < slides.length && (
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="relative flex flex-col h-screen w-full overflow-hidden"
          >

            {/* Split View Editorial Layout */}
            <div className="flex flex-col md:flex-row h-full w-full">

              {/* Media Side (Left/Top) */}
              <div className="w-full md:w-[55%] h-[50%] md:h-full relative overflow-hidden bg-[#141414]">
                <img
                  className="absolute inset-0 w-full h-full object-cover grayscale-[0.2] brightness-75 transition-transform duration-[2000ms] ease-out scale-105"
                  src={slide.image}
                  alt={slide.headline}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-[#0A0A0A]/30" />

                {/* Floating Glass Badge */}
                <div className="absolute bottom-8 left-8 z-20 bg-white/10 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/10 shadow-2xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#E5FF3B] flex items-center justify-center text-black">
                    <Sparkles className="w-5 h-5 fill-current" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-white uppercase tracking-wider">{slide.sideBadge?.title || 'Creative Hub'}</p>
                    <p className="text-[10px] text-white/60 font-bold">{slide.sideBadge?.subtitle || 'Active Now'}</p>
                  </div>
                </div>
              </div>

              {/* Content Side (Right/Bottom) */}
              <div className="w-full md:w-[45%] flex flex-col justify-center items-start px-8 md:px-16 lg:px-24 bg-[#0A0A0A] relative">

                <div className="max-w-[400px] w-full text-left space-y-8">
                  {/* Progress Line */}
                  <div className="flex gap-2 mb-2">
                    {slides.map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-1 rounded-full transition-all duration-300 ${idx === currentSlide ? 'w-10 bg-[#E5FF3B]' : 'w-4 bg-[#2A2A2A]'}`}
                      />
                    ))}
                  </div>

                  <div className="space-y-4">
                    <span className="inline-block text-[10px] font-black tracking-[0.3em] text-[#E5FF3B] uppercase">
                      {slide.label}
                    </span>

                    <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.1] text-white">
                      {slide.headline.split(slide.highlightedText || '').map((part, i, arr) => (
                        <React.Fragment key={i}>
                          {part}
                          {i < arr.length - 1 && <span className="text-[#E5FF3B] italic block md:inline">{slide.highlightedText}</span>}
                        </React.Fragment>
                      ))}
                    </h1>

                    <p className="text-sm md:text-base text-[#A1A1AA] leading-relaxed font-medium">
                      {slide.subtext}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-4 pt-4">
                    <button
                      onClick={currentSlide === slides.length - 1 ? onNavigateToMap : onNextSlide}
                      className="group bg-[#E5FF3B] text-black font-black py-4 px-8 rounded-2xl flex items-center justify-between shadow-[0_10px_30px_rgba(229,255,59,0.2)] hover:bg-[#d8f030] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 cursor-pointer"
                    >
                      <span className="text-sm tracking-wide">
                        {currentSlide === slides.length - 1 ? 'GET STARTED' : 'CONTINUE'}
                      </span>
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>

                    <div className="flex items-center justify-between px-2">
                      <button
                        onClick={onPrevSlide}
                        disabled={currentSlide === 0}
                        className={`text-xs font-bold uppercase tracking-widest transition-all ${currentSlide === 0 ? 'opacity-0' : 'text-[#737373] hover:text-white cursor-pointer'}`}
                      >
                        Back
                      </button>

                      <button
                        onClick={onNavigateToLogin}
                        className="text-xs font-bold uppercase tracking-widest text-[#E5FF3B] hover:underline cursor-pointer"
                      >
                        Sign In
                      </button>
                    </div>
                  </div>

                  {/* Social Proof */}
                  <div className="pt-10 border-t border-[#1A1A1A] flex items-center gap-4">
                    <div className="flex -space-x-3">
                      <img className="w-9 h-9 rounded-full border-2 border-[#0A0A0A] object-cover bg-[#141414]" src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=100&q=80" alt="1" />
                      <img className="w-9 h-9 rounded-full border-2 border-[#0A0A0A] object-cover bg-[#141414]" src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80" alt="2" />
                      <img className="w-9 h-9 rounded-full border-2 border-[#0A0A0A] object-cover bg-[#141414]" src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&q=80" alt="3" />
                      <div className="w-9 h-9 rounded-full border-2 border-[#0A0A0A] bg-[#1A1A1A] text-[#E5FF3B] flex items-center justify-center text-[10px] font-black shadow-sm">+12k</div>
                    </div>
                    <p className="text-[11px] font-bold text-[#737373] uppercase tracking-widest">Join creative souls</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
