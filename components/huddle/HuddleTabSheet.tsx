import React from 'react';
import { X } from 'lucide-react';
import type { HuddleMobileTabId } from './HuddleMobileTabs';

type Props = {
  tab: HuddleMobileTabId | null;
  onClose: () => void;
  children: React.ReactNode;
};

const TITLES: Record<HuddleMobileTabId, string> = {
  hands: 'Hands',
  chat: 'Chat',
  attendance: 'Attendance',
};

/** Bottom sheet host for Hands / Chat / Attendance panels. */
export const HuddleTabSheet: React.FC<Props> = ({ tab, onClose, children }) => {
  if (!tab) return null;
  return (
    <div
      className="fixed inset-0 z-[440] flex flex-col justify-end bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={TITLES[tab]}
      onClick={onClose}
      data-testid="huddle-tab-sheet"
    >
      <div
        className="bg-[#1a1216] text-white rounded-t-[28px] w-full max-w-lg mx-auto h-[min(70vh,560px)] flex flex-col shadow-2xl border border-white/10 border-b-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-2 pt-2 shrink-0">
          <div className="w-10" />
          <div className="w-10 h-1 rounded-full bg-white/20" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-white/60"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
};
