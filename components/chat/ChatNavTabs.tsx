import React from 'react';
import { HandHeart, MessageCircle, Radio, Users } from 'lucide-react';
import { CHAT_HOME_TAB_ORDER, type ChatHomeTab } from '../../lib/chatHomeTabs';

type TabDef = {
  id: ChatHomeTab;
  label: string;
  icon: React.ReactNode;
  /** Unread / live count for the badge (0 = hide). */
  count?: number;
  live?: boolean;
};

/**
 * Prayer Gathering | Ministries | Messages | Live Huddles — under the PLCC Ka Link header.
 * Large touch targets, keyboard-friendly tablist.
 */
export const ChatNavTabs: React.FC<{
  active: ChatHomeTab;
  onChange: (tab: ChatHomeTab) => void;
  prayerUnread?: number;
  ministryUnread?: number;
  messageUnread?: number;
  liveCount?: number;
}> = ({ active, onChange, prayerUnread = 0, ministryUnread = 0, messageUnread = 0, liveCount = 0 }) => {
  const tabs: TabDef[] = [
    { id: 'prayer', label: 'Prayer', icon: <HandHeart size={18} aria-hidden />, count: prayerUnread },
    { id: 'ministries', label: 'Ministries', icon: <Users size={18} aria-hidden />, count: ministryUnread },
    { id: 'messages', label: 'Messages', icon: <MessageCircle size={18} aria-hidden />, count: messageUnread },
    { id: 'huddles', label: 'Live', icon: <Radio size={18} aria-hidden />, count: liveCount, live: liveCount > 0 },
  ];
  const order = CHAT_HOME_TAB_ORDER;

  return (
    <div
      role="tablist"
      aria-label="PLCC Ka Link sections"
      className="mb-5 grid grid-cols-4 gap-1 rounded-2xl bg-white border border-gray-200 p-1 shadow-sm"
      data-testid="jordan-home-tabs"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`chat-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`chat-panel-${tab.id}`}
            aria-label={tab.id === 'prayer' ? 'Prayer Gathering' : tab.id === 'huddles' ? 'Live Ka Links' : tab.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              const i = order.indexOf(tab.id);
              let next: ChatHomeTab | null = null;
              if (e.key === 'ArrowRight') next = order[(i + 1) % order.length];
              else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length];
              else if (e.key === 'Home') next = order[0];
              else if (e.key === 'End') next = order[order.length - 1];
              if (next) {
                e.preventDefault();
                onChange(next);
                document.getElementById(`chat-tab-${next}`)?.focus();
              }
            }}
            className={`relative min-h-[56px] rounded-xl px-1 py-2 flex flex-col items-center justify-center gap-1 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy/40 ${
              selected ? 'bg-burgundy text-white shadow-sm' : 'text-gray-600 hover:bg-burgundy/5 hover:text-burgundy'
            }`}
          >
            <span className="relative inline-flex">
              {tab.icon}
              {tab.live ? (
                <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" aria-hidden />
              ) : null}
            </span>
            <span className="text-[12px] font-black leading-tight">{tab.label}</span>
            {tab.count && tab.count > 0 ? (
              <span
                className={`absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black leading-[18px] text-center ${
                  selected ? 'bg-gold text-burgundy' : tab.id === 'huddles' ? 'bg-emerald-600 text-white' : 'bg-burgundy text-white'
                }`}
                aria-label={
                  tab.id === 'huddles' ? `${tab.count} live Ka Link${tab.count === 1 ? '' : 's'}` : `${tab.count} unread`
                }
              >
                {tab.count > 99 ? '99+' : tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
