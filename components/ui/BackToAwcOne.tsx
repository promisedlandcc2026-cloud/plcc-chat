import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { AWC_ONE_URL } from '../../lib/appLinks';

/** "‹ PLCC ONE" — back to the launcher with every PLCC app. */
export const BackToAwcOne: React.FC<{ className?: string }> = ({ className = '' }) => (
  <a
    href={AWC_ONE_URL}
    aria-label="Back to PLCC ONE, all PLCC apps"
    className={`inline-flex items-center gap-1.5 h-11 rounded-full border border-white/15 bg-[#211915] pl-1.5 pr-3.5 text-[#F7EFE6] text-sm font-black whitespace-nowrap shrink-0 active:scale-95 transition-transform motion-reduce:transition-none ${className}`}
  >
    <ChevronLeft size={18} aria-hidden />
    <img src="/awc-one-seal.webp" alt="" width={26} height={26} className="w-[26px] h-[26px] rounded-full max-[374px]:hidden" />
    PLCC ONE
  </a>
);
