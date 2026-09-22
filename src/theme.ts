export function cn(...inputs: (string | boolean | undefined | null)[]) {
  return inputs.filter(Boolean).join(' ');
}

// Global Theme Token Constants - Unified Dark Palette
export const THEME = {
  colors: {
    primary: '#DDF639',
    primaryDark: '#141414',
    background: '#0A0A0A',
    surface: '#141414',
    surfaceElevated: '#1E1E1E',
    textPrimary: '#FFFFFF',
    textSecondary: '#A1A1AA',
    border: '#2A2A2A',
    divider: '#2A2A2A',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
  },
  typography: {
    fontFamily: '"Plus Jakarta Sans", sans-serif',
    heading: 'font-extrabold text-[20px] text-white tracking-tight',
    subheading: 'font-bold text-[16px] text-white',
    body: 'font-medium text-[14px] text-white/90 leading-normal',
    caption: 'font-medium text-[12px] text-[#A1A1AA]',
  },
  header: 'h-[64px] min-h-[64px] bg-[#0A0A0A] border-b border-[#2A2A2A] px-4 flex items-center justify-between z-30 select-none',
  card: 'bg-[#141414] border border-[#2A2A2A] rounded-2xl p-4 transition-all',
  button: {
    primary: 'bg-[#E5FF3B] hover:bg-[#d8f030] active:scale-[0.98] text-black font-bold text-sm px-5 py-2.5 rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2',
    secondary: 'bg-[#1E1E1E] hover:bg-[#2A2A2A] active:scale-[0.98] text-white font-semibold text-sm px-5 py-2.5 rounded-xl border border-[#2A2A2A] transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2',
    outlined: 'border border-[#2A2A2A] hover:bg-[#1E1E1E] active:scale-[0.98] text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2',
    icon: 'p-2 hover:bg-[#1E1E1E] active:bg-[#2A2A2A] text-white rounded-full transition-colors cursor-pointer flex items-center justify-center shrink-0',
  },
  bottomNav: 'h-[64px] bg-[#0A0A0A] border-t border-[#2A2A2A] px-4 flex items-center justify-around z-40 select-none',
  input: 'w-full bg-[#141414] border border-[#2A2A2A] focus:border-[#E5FF3B] focus:ring-1 focus:ring-[#E5FF3B] rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition-all',
};
