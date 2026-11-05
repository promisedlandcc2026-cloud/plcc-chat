import React, { useState } from 'react';
import { FileText, Download, X } from 'lucide-react';
import type { CommunityChatAttachment } from '../../lib/communityChatTypes';
import { formatFileSize, stableMediaUrl } from '../../lib/chatMedia';
import { Portal } from './Portal';

/** Photos, voice notes, videos and documents inside a chat bubble. */
export const ChatAttachments: React.FC<{
  attachments: CommunityChatAttachment[];
  mine: boolean;
}> = ({ attachments, mine }) => {
  const [viewing, setViewing] = useState<string | null>(null);
  if (!attachments.length) return null;

  return (
    <div className="space-y-2 mb-1">
      {attachments.map((att) => {
        const url = stableMediaUrl(att);
        if (!url) {
          return (
            <p key={att.id} className={`text-xs italic ${mine ? 'text-white/70' : 'text-gray-500'}`}>
              This file is no longer available.
            </p>
          );
        }
        if (att.kind === 'image') {
          return (
            <button
              key={att.id}
              type="button"
              onClick={() => setViewing(url)}
              className="block w-full overflow-hidden rounded-xl bg-black/5"
              aria-label="Open photo"
            >
              <img
                src={url}
                alt={att.name || 'Photo'}
                loading="lazy"
                className="w-full max-h-80 object-cover"
              />
            </button>
          );
        }
        if (att.kind === 'audio') {
          return (
            <audio
              key={att.id}
              controls
              preload="metadata"
              src={url}
              className="w-full min-w-[220px] h-11"
              aria-label="Voice message"
            />
          );
        }
        if (att.kind === 'video') {
          return (
            <video
              key={att.id}
              controls
              playsInline
              preload="metadata"
              src={url}
              className="w-full max-h-80 rounded-xl bg-black"
            />
          );
        }
        return (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download={att.name}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 min-h-[52px] ${
              mine ? 'bg-white/15' : 'bg-gray-50 border border-gray-100'
            }`}
          >
            <FileText size={22} className={mine ? 'text-white' : 'text-burgundy'} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold truncate">{att.name}</span>
              <span className={`block text-xs ${mine ? 'text-white/70' : 'text-gray-500'}`}>
                {formatFileSize(att.size)}
              </span>
            </span>
            <Download size={18} aria-hidden />
          </a>
        );
      })}

      {viewing ? (
        <Portal>
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setViewing(null)}
        >
          <button
            type="button"
            onClick={() => setViewing(null)}
            className="absolute top-4 right-4 min-h-[48px] min-w-[48px] rounded-full bg-white/15 text-white flex items-center justify-center"
            aria-label="Close photo"
          >
            <X size={24} />
          </button>
          <img src={viewing} alt="" className="max-h-full max-w-full object-contain" />
        </div>
        </Portal>
      ) : null}
    </div>
  );
};
