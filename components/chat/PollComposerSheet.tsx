import React, { useState } from 'react';
import { BarChart3, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Portal } from './Portal';

const MAX_OPTIONS = 10;

/** "New poll" sheet: a question, 2–10 choices, and two simple switches. */
export const PollComposerSheet: React.FC<{
  onCancel: () => void;
  onCreate: (input: { question: string; options: string[]; multi: boolean; anonymous: boolean }) => Promise<void>;
}> = ({ onCancel, onCreate }) => {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= 2;

  const setOption = (i: number, v: string) => setOptions((prev) => prev.map((o, j) => (j === i ? v : o)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ question: question.trim(), options: filled, multi, anonymous });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not start that poll. Please try again.');
      setBusy(false);
    }
  };

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <label className="flex items-center justify-between gap-3 min-h-[56px] rounded-2xl bg-eggshell px-4 cursor-pointer">
      <span>
        <span className="block text-[15px] font-bold text-[#1A1A1A]">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-6 w-6 accent-[#1d372c]" />
    </label>
  );

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={busy ? undefined : onCancel}>
        <form
          onSubmit={submit}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="poll-title"
          className="w-full max-w-[500px] max-h-[92vh] overflow-y-auto rounded-t-3xl lg:rounded-3xl bg-white shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 id="poll-title" className="flex items-center gap-2 text-xl font-bold text-[#1A1A1A]">
              <BarChart3 size={22} className="text-burgundy" aria-hidden /> New poll
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

          <div>
            <label htmlFor="poll-question" className="block text-sm font-bold text-[#1A1A1A] mb-1.5">Question</label>
            <textarea
              id="poll-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="e.g. Which Saturday works for the cleanup?"
              className="w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
              autoFocus
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="block text-sm font-bold text-[#1A1A1A] mb-1.5">Choices</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`poll-opt-${i}`}>Choice {i + 1}</label>
                <input
                  id={`poll-opt-${i}`}
                  value={o}
                  onChange={(e) => setOption(i, e.target.value)}
                  maxLength={100}
                  placeholder={`Choice ${i + 1}`}
                  className="flex-1 min-h-[52px] rounded-2xl border border-gray-200 px-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
                />
                {options.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                    className="min-h-[48px] min-w-[48px] rounded-2xl text-gray-500 hover:bg-gray-100 flex items-center justify-center"
                    aria-label={`Remove choice ${i + 1}`}
                  >
                    <Trash2 size={18} />
                  </button>
                ) : null}
              </div>
            ))}
            {options.length < MAX_OPTIONS ? (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="w-full min-h-[48px] rounded-2xl border-2 border-dashed border-gray-300 text-burgundy font-bold flex items-center justify-center gap-2"
              >
                <Plus size={18} aria-hidden /> Add a choice
              </button>
            ) : null}
          </fieldset>

          <div className="space-y-2">
            {toggle(multi, setMulti, 'Allow more than one answer', 'People can pick several choices')}
            {toggle(anonymous, setAnonymous, 'Keep votes private', 'Show counts only, not who voted')}
          </div>

          {error ? <p className="text-sm font-medium text-burgundy" role="alert">{error}</p> : null}

          <button
            type="submit"
            disabled={!ready || busy}
            className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <BarChart3 size={20} aria-hidden />}
            Send poll
          </button>
        </form>
      </div>
    </Portal>
  );
};
