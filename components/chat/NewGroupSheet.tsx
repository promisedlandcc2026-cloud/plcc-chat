import React, { useEffect, useState } from 'react';
import { Portal } from './Portal';
import { Loader2, X } from 'lucide-react';
import type { ChatGroupKind, ChatPerson, CommunityChatChannel } from '../../lib/communityChatTypes';
import { createGroup, fetchMyMinistries } from '../../lib/communityChatClient';
import { PeoplePicker } from './PeoplePicker';

const KINDS: Array<{ kind: ChatGroupKind; title: string; body: string }> = [
  { kind: 'private', title: 'Private group', body: 'Only the people you add can see it.' },
  { kind: 'ministry', title: 'Ministry group', body: 'Everyone in the ministry is added automatically.' },
  { kind: 'open', title: 'Whole church', body: 'Every member can see and join it.' },
];

/** Leaders: create a group (like WhatsApp "New group"). */
export const NewGroupSheet: React.FC<{
  onClose: () => void;
  onCreated: (channel: CommunityChatChannel) => void;
}> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ChatGroupKind>('private');
  const [ministryId, setMinistryId] = useState('');
  const [ministries, setMinistries] = useState<Array<{ id: string; name: string }> | null>(null);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [announceOnly, setAnnounceOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'ministry' || ministries) return;
    fetchMyMinistries()
      .then(setMinistries)
      .catch(() => setMinistries([]));
  }, [kind, ministries]);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError('Give the group a name.');
    if (kind === 'ministry' && !ministryId) return setError('Pick the ministry for this group.');
    setBusy(true);
    try {
      const channel = await createGroup({
        name: name.trim(),
        description: description.trim(),
        kind,
        ministryId: kind === 'ministry' ? ministryId : null,
        memberIds: kind === 'open' ? [] : people.map((p) => p.id),
        announceOnly,
      });
      onCreated(channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.');
      setBusy(false);
    }
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[500px] lg:max-w-[520px] max-h-[92dvh] overflow-y-auto bg-eggshell rounded-t-3xl lg:rounded-3xl shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New group"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[#1A1A1A]">New group</h2>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500" aria-label="Close">
            <X size={22} />
          </button>
        </div>

        <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="group-name">
          Group name
        </label>
        <input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Choir, Youth Leaders, Thanksgiving Team"
          className="w-full min-h-[52px] rounded-2xl border border-gray-200 bg-white px-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
        />
        <label className="block text-sm font-bold text-gray-700 mt-4 mb-1" htmlFor="group-desc">
          What it’s for <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <input
          id="group-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          className="w-full min-h-[48px] rounded-2xl border border-gray-200 bg-white px-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
        />

        <fieldset className="mt-5">
          <legend className="text-sm font-bold text-gray-700 mb-2">Who can see it</legend>
          <div className="space-y-2">
            {KINDS.map((k) => (
              <label
                key={k.kind}
                className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer ${
                  kind === k.kind ? 'border-burgundy bg-burgundy/5' : 'border-gray-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="group-kind"
                  checked={kind === k.kind}
                  onChange={() => setKind(k.kind)}
                  className="mt-1 h-5 w-5 accent-[#1d372c]"
                />
                <span>
                  <span className="block font-bold text-[#1A1A1A]">{k.title}</span>
                  <span className="block text-sm text-gray-500">{k.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {kind === 'ministry' ? (
          <div className="mt-4">
            <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="group-ministry">
              Ministry
            </label>
            <select
              id="group-ministry"
              value={ministryId}
              onChange={(e) => setMinistryId(e.target.value)}
              className="w-full min-h-[52px] rounded-2xl border border-gray-200 bg-white px-4 text-base"
            >
              <option value="">{ministries === null ? 'Loading…' : 'Choose a ministry'}</option>
              {(ministries || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <label className="mt-5 flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={announceOnly}
            onChange={(e) => setAnnounceOnly(e.target.checked)}
            className="mt-1 h-5 w-5 accent-[#1d372c]"
          />
          <span>
            <span className="block font-bold text-[#1A1A1A]">📢 Announcements only</span>
            <span className="block text-sm text-gray-500">
              Only leaders of this group can post. Everyone else can read and react.
            </span>
          </span>
        </label>

        {kind !== 'open' ? (
          <div className="mt-5">
            <p className="text-sm font-bold text-gray-700 mb-2">
              {kind === 'ministry' ? 'Add anyone else' : 'Add people'}
            </p>
            <PeoplePicker selected={people} onChange={setPeople} />
          </div>
        ) : null}

        {error ? <p className="text-sm text-burgundy font-semibold mt-4">{error}</p> : null}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-5 w-full min-h-[56px] rounded-2xl bg-burgundy text-white font-extrabold text-base flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="animate-spin" size={18} /> : null}
          Create group
        </button>
      </div>
    </div>
    </Portal>
  );
};
