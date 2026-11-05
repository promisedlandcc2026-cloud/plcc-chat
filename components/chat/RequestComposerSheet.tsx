import React, { useState } from 'react';
import { Car, Hand, HeartHandshake, Home, Loader2, Soup, Users, X } from 'lucide-react';
import { Portal } from './Portal';
import { REQUEST_CATEGORY_OPTIONS, type ChatRequestCategory } from '../../lib/communityChatTypes';

const ICONS: Record<ChatRequestCategory, typeof Car> = {
  ride: Car,
  visit: Users,
  meal: Soup,
  errand: Home,
  other: Hand,
};

/** "Ask for help": pick the kind of help, say what you need, send. */
export const RequestComposerSheet: React.FC<{
  onCancel: () => void;
  onCreate: (input: { category: ChatRequestCategory; details: string }) => Promise<void>;
}> = ({ onCancel, onCreate }) => {
  const [category, setCategory] = useState<ChatRequestCategory | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(category) && details.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy || !category) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ category, details: details.trim() });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not send that request. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={busy ? undefined : onCancel}>
        <form
          onSubmit={submit}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="req-title"
          className="w-full max-w-[500px] max-h-[92vh] overflow-y-auto rounded-t-3xl lg:rounded-3xl bg-white shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 id="req-title" className="flex items-center gap-2 text-xl font-bold text-[#1A1A1A]">
              <HeartHandshake size={22} className="text-burgundy" aria-hidden /> Ask for help
            </h2>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="min-h-[44px] min-w-[44px] rounded-full bg-gray-100 text-gray-700 flex items-center justify-center"
              aria-label="Cancel"
            >
              <X size={20} />
            </button>
          </div>

          <fieldset>
            <legend className="block text-sm font-bold text-[#1A1A1A] mb-2">What do you need?</legend>
            <div className="grid grid-cols-2 gap-2">
              {REQUEST_CATEGORY_OPTIONS.map((o) => {
                const Icon = ICONS[o.id];
                const on = category === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setCategory(o.id)}
                    aria-pressed={on}
                    className={`min-h-[76px] rounded-2xl border-2 px-3 py-2 text-left flex items-start gap-2 ${
                      on ? 'border-burgundy bg-burgundy/5' : 'border-gray-200 bg-white'
                    } ${o.id === 'other' ? 'col-span-2' : ''}`}
                  >
                    <Icon size={22} className="text-burgundy shrink-0 mt-0.5" aria-hidden />
                    <span>
                      <span className="block text-[15px] font-bold text-[#1A1A1A]">{o.label}</span>
                      <span className="block text-xs text-gray-500">{o.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="req-details" className="block text-sm font-bold text-[#1A1A1A] mb-1.5">Tell us a little more</label>
            <textarea
              id="req-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. I need a ride to my doctor's appointment on Thursday at 10 AM."
              className="w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
            />
            <p className="mt-1 text-xs text-gray-500">Everyone in this chat will see your request. For something private, ask in a private message.</p>
          </div>

          {error ? <p className="text-sm font-medium text-burgundy" role="alert">{error}</p> : null}

          <button
            type="submit"
            disabled={!ready || busy}
            className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <HeartHandshake size={20} aria-hidden />}
            Send request
          </button>
        </form>
      </div>
    </Portal>
  );
};
