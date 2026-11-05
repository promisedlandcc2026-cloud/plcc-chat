import React, { useEffect, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import type { ChatPerson } from '../../lib/communityChatTypes';
import { searchPeople } from '../../lib/communityChatClient';

/** Search church members and tick the ones to add. */
export const PeoplePicker: React.FC<{
  selected: ChatPerson[];
  onChange: (next: ChatPerson[]) => void;
  /** When adding to an existing group: leaves out people already in it. */
  channelId?: string;
}> = ({ selected, onChange, channelId }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ChatPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchPeople(q.trim(), channelId)
        .then((r) => {
          if (!alive) return;
          setResults(r);
          setError(null);
        })
        .catch((err) => alive && setError(err instanceof Error ? err.message : 'Could not search members.'))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, channelId]);

  const chosen = new Set(selected.map((p) => p.id));
  const toggle = (p: ChatPerson) =>
    onChange(chosen.has(p.id) ? selected.filter((x) => x.id !== p.id) : [...selected, { id: p.id, name: p.name }]);

  return (
    <div>
      {selected.length ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {selected.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p)}
              className="inline-flex items-center gap-1 min-h-[36px] pl-3 pr-2 rounded-full bg-burgundy/10 text-burgundy text-sm font-semibold"
              aria-label={`Remove ${p.name}`}
            >
              {p.name}
              <X size={14} aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
      <label className="relative block">
        <span className="sr-only">Search members</span>
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          className="w-full min-h-[48px] rounded-2xl border border-gray-200 bg-white pl-10 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
        />
      </label>
      {error ? <p className="text-sm text-burgundy mt-2">{error}</p> : null}
      <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white">
        {loading && !results.length ? (
          <li className="p-4 text-sm text-gray-500 flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} /> Searching…
          </li>
        ) : results.length ? (
          results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                className="w-full min-h-[52px] px-4 flex items-center justify-between gap-3 text-left active:bg-gray-50 hover:bg-gray-50"
                aria-pressed={chosen.has(p.id)}
              >
                <span className="font-semibold text-[#1A1A1A]">{p.name}</span>
                <span
                  className={`h-6 w-6 rounded-full border-2 flex items-center justify-center ${
                    chosen.has(p.id) ? 'bg-burgundy border-burgundy text-white' : 'border-gray-300'
                  }`}
                  aria-hidden
                >
                  {chosen.has(p.id) ? <Check size={14} /> : null}
                </span>
              </button>
            </li>
          ))
        ) : (
          <li className="p-4 text-sm text-gray-500">{q.trim() ? 'No one found.' : 'Type a name to search.'}</li>
        )}
      </ul>
    </div>
  );
};
