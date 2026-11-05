import React from 'react';
import type { TypingPerson } from '../../lib/useRoomLive';

/**
 * "…" bubble while someone in the room is typing (live, same channel as new messages).
 * Shows their first name above it in group chats; the dots bounce (still for reduced motion).
 */
export const TypingBubble: React.FC<{ typers: TypingPerson[]; label: string; isDm: boolean }> = ({ typers, label, isDm }) => {
  if (!typers.length) return null;
  const names = typers.map((t) => t.name.split(/\s+/)[0] || t.name);
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} people`;
  return (
    <div className="mr-auto w-fit max-w-[88%] awc-typing-in" aria-hidden>
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-4 py-2.5">
        {!isDm ? <p className="text-xs font-bold text-burgundy mb-1">{who}</p> : null}
        <span className="flex items-center gap-1.5 h-4" title={label}>
          <span className="awc-typing-dot" />
          <span className="awc-typing-dot" style={{ animationDelay: '0.18s' }} />
          <span className="awc-typing-dot" style={{ animationDelay: '0.36s' }} />
        </span>
      </div>
    </div>
  );
};
