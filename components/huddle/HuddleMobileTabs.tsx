import React from 'react';
import { Hand, MessageCircle, Users } from 'lucide-react';

export type HuddleMobileTabId = 'hands' | 'chat' | 'attendance';

type Props = {
  active: HuddleMobileTabId | null;
  onChange: (tab: HuddleMobileTabId | null) => void;
  handsCount?: number;
  chatUnread?: number;
  attendanceCount?: number;
  /** Which tabs to show (default: all three). */
  tabs?: HuddleMobileTabId[];
  /** Optional one-tap action button shown after the tabs (e.g. Share). */
  action?: {
    label: string;
    Icon: typeof Hand;
    onClick: () => void;
    /** Short confirmation shown in place of the label (e.g. "Copied"). */
    doneLabel?: string | null;
  };
};

const TABS: {
  id: HuddleMobileTabId;
  label: string;
  Icon: typeof Hand;
}[] = [
  { id: 'hands', label: 'Hands', Icon: Hand },
  { id: 'chat', label: 'Chat', Icon: MessageCircle },
  { id: 'attendance', label: 'Attendance', Icon: Users },
];

export const HuddleMobileTabs: React.FC<Props> = ({
  active,
  onChange,
  handsCount = 0,
  chatUnread = 0,
  attendanceCount = 0,
  tabs,
  action,
}) => {
  const shown = tabs && tabs.length ? TABS.filter((t) => tabs.includes(t.id)) : TABS;
  const count = shown.length + (action ? 1 : 0);
  const cols = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-2' : count === 3 ? 'grid-cols-3' : 'grid-cols-4';
  return (
    <nav
      className={`grid ${cols} gap-1 px-1 py-1 rounded-2xl bg-white/5 border border-white/10`}
      aria-label="Huddle panels"
      data-testid="huddle-mobile-tabs"
    >
      {shown.map(({ id, label, Icon }) => {
        const selected = active === id;
        const badge =
          id === 'hands'
            ? handsCount
            : id === 'chat'
              ? chatUnread
              : attendanceCount;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(selected ? null : id)}
            className={`relative min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-black uppercase tracking-wide transition-colors ${
              selected ? 'bg-gold text-burgundy' : 'text-white/70 hover:bg-white/10'
            }`}
            aria-pressed={selected}
            aria-label={
              id === 'chat' && chatUnread > 0
                ? `${label}, ${chatUnread} unread`
                : id === 'hands' && handsCount > 0
                  ? `${label}, ${handsCount} raised`
                  : label
            }
          >
            <Icon size={16} aria-hidden />
            <span>{label}</span>
            {badge > 0 ? (
              <span
                className={`absolute top-1 right-2 min-w-[20px] h-5 px-1 rounded-full text-[11px] font-black flex items-center justify-center ${
                  selected ? 'bg-burgundy text-gold' : 'bg-gold text-burgundy'
                }`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </button>
        );
      })}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={`relative min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-black uppercase tracking-wide transition-colors ${
            action.doneLabel ? 'bg-gold text-burgundy' : 'text-white/70 hover:bg-white/10'
          }`}
          aria-label={action.label}
          data-testid="huddle-tab-action"
        >
          <action.Icon size={16} aria-hidden />
          <span>{action.doneLabel || action.label}</span>
        </button>
      ) : null}
    </nav>
  );
};
