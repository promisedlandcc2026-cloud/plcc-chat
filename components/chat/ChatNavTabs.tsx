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
    <div role="tablist" aria-label="PLCC Ka Link sections" className="kl-tabs" data-testid="jordan-home-tabs">
      {tabs.map((tab) => {
        const selected = active === tab.id;
        const count = tab.count && tab.count > 0 ? tab.count : 0;
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
            className={`kl-tab ${selected ? 'kl-tab-on' : ''}`}
          >
            <span className="kl-tab-icon">
              {tab.icon}
              {tab.live ? <span className="kl-tab-live" aria-hidden /> : null}
            </span>
            <span className="kl-tab-label">{tab.label}</span>
            {count ? (
              <span
                className={`kl-tab-count ${tab.id === 'huddles' ? 'kl-tab-count-live' : ''}`}
                aria-label={tab.id === 'huddles' ? `${count} live Ka Link${count === 1 ? '' : 's'}` : `${count} unread`}
              >
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
