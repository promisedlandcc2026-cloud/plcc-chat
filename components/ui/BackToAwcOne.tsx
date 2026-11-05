import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { AWC_ONE_URL } from '../../lib/appLinks';

/** "‹ PLCC ONE" — back to the launcher with every PLCC app. */
export const BackToAwcOne: React.FC<{ className?: string }> = ({ className = '' }) => (
  <a
    href={AWC_ONE_URL}
    aria-label="Back to PLCC ONE, all PLCC apps"
    className={`inline-flex items-center gap-1.5 h-11 rounded-full border-2 border-[#C9A35A] bg-[#15271f] pl-1.5 pr-3.5 text-[#FFE08A] text-sm font-black whitespace-nowrap shrink-0 shadow-[0_0_10px_rgba(201, 163, 90,0.35)] active:scale-95 transition-transform motion-reduce:transition-none ${className}`}
  >
    <ChevronLeft size={18} aria-hidden />
    <img src="/awc-one-seal.webp" alt="" width={26} height={26} className="w-[26px] h-[26px] rounded-full max-[374px]:hidden" />
    PLCC ONE
  </a>
);
