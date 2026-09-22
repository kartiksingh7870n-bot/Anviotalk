import React, { useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';

interface SplashIntroProps {
  onComplete?: () => void;
}

export default function SplashIntro({ onComplete }: SplashIntroProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (onComplete) {
      const timer = setTimeout(() => {
        onComplete();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [onComplete]);

  return (
    <div className="fixed inset-0 w-screen h-screen bg-[#000000] z-[9999] flex flex-col items-center justify-center overflow-hidden select-none">
      {/* Centered Logo Only */}
      <div className="flex flex-col items-center justify-center p-4">
        <div className="w-36 h-36 md:w-52 md:h-52 flex items-center justify-center transition-transform duration-500 hover:scale-105">
          {!imgFailed ? (
            <img
              src="https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png"
              alt="Anvio Talk Logo"
              loading="eager"
              decoding="async"
              className="w-full h-full object-contain filter drop-shadow-lg"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-32 h-32 rounded-3xl bg-gradient-to-tr from-[#E5FF3B] to-emerald-400 flex items-center justify-center shadow-lg">
              <MessageSquareText className="w-14 h-14 text-black" />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Center Credit Only */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
        <p className="text-xs font-semibold tracking-wider text-gray-300 font-sans">
          Kritim group
        </p>
      </div>
    </div>
  );
}

