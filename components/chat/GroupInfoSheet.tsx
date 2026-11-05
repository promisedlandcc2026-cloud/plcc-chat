import React, { useEffect, useState } from 'react';
import { Portal } from './Portal';
import { Loader2, Shield, UserMinus, X } from 'lucide-react';
import type { ChatPerson } from '../../lib/communityChatTypes';
import {
  addGroupMembers,
  fetchGroupMembers,
  removeGroupMember,
  updateGroupSettings,
} from '../../lib/communityChatClient';
import { PeoplePicker } from './PeoplePicker';

/**
 * Group info. Admins (room moderators/creator, church leaders) can rename,
 * switch announcements-only, see members, add and remove people.
 * Everyone else sees what the group is for.
 */
export const GroupInfoSheet: React.FC<{
  channelId: string;
  name: string;
  description: string | null;
  visibility: string | null;
  announceOnly: boolean;
  canManage: boolean;
  selfId: string;
  onClose: () => void;
  onChanged: (patch: { name?: string; description?: string | null; announceOnly?: boolean }) => void;
}> = ({ channelId, name, description, visibility, announceOnly, canManage, selfId, onClose, onChanged }) => {
  const [members, setMembers] = useState<ChatPerson[] | null>(null);
  const [adding, setAdding] = useState<ChatPerson[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOpen = visibility === 'open';

  useEffect(() => {
    if (!canManage || isOpen) return;
    fetchGroupMembers(channelId)
      .then(setMembers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the members.'));
  }, [canManage, channelId, isOpen]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const saveDetails = () =>
    run('details', async () => {
      const ch = await updateGroupSettings(channelId, { name: editName.trim(), description: editDesc.trim() });
      onChanged({ name: ch?.name || editName.trim(), description: ch?.description ?? (editDesc.trim() || null) });
    });

  const toggleAnnounce = () =>
    run('announce', async () => {
      await updateGroupSettings(channelId, { announceOnly: !announceOnly });
      onChanged({ announceOnly: !announceOnly });
    });

  const addPeople = () =>
    run('add', async () => {
      const next = await addGroupMembers(channelId, adding.map((p) => p.id));
      setMembers(next);
      setAdding([]);
      setShowAdd(false);
    });

  const remove = (p: ChatPerson) =>
    run(`rm-${p.id}`, async () => {
      await removeGroupMember(channelId, p.id);
      setMembers((m) => (m || []).filter((x) => x.id !== p.id));
    });

  const detailsChanged = editName.trim() !== name || editDesc.trim() !== (description || '');

  return (
    <Portal>
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[500px] lg:max-w-[520px] max-h-[92dvh] overflow-y-auto bg-eggshell rounded-t-3xl lg:rounded-3xl shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Group info"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-[#1A1A1A] truncate pr-3">{name}</h2>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500" aria-label="Close">
            <X size={22} />
          </button>
        </div>
        {description ? <p className="text-sm text-gray-600 mb-3">{description}</p> : null}
        {announceOnly ? (
          <p className="text-sm font-semibold text-gold-ink bg-gold/15 rounded-xl px-3 py-2 mb-3">
            📢 Announcements only — leaders post, everyone can read and react.
          </p>
        ) : null}

        {!canManage ? (
          <p className="text-sm text-gray-500">Only this group’s admins can change its settings or members.</p>
        ) : (
          <>
            <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-3">
              <label className="block text-sm font-bold text-gray-700" htmlFor="gi-name">
                Group name
              </label>
              <input
                id="gi-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={80}
                className="w-full min-h-[48px] rounded-xl border border-gray-200 px-3 text-base"
              />
              <label className="block text-sm font-bold text-gray-700" htmlFor="gi-desc">
                What it’s for
              </label>
              <input
                id="gi-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={300}
                className="w-full min-h-[48px] rounded-xl border border-gray-200 px-3 text-base"
              />
              {detailsChanged ? (
                <button
                  type="button"
                  onClick={() => void saveDetails()}
                  disabled={busy === 'details' || editName.trim().length < 2}
                  className="w-full min-h-[48px] rounded-xl bg-burgundy text-white font-bold disabled:opacity-60"
                >
                  {busy === 'details' ? 'Saving…' : 'Save'}
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void toggleAnnounce()}
              disabled={busy === 'announce'}
              className="mt-3 w-full flex items-center justify-between gap-3 rounded-2xl bg-white border border-gray-100 p-4 text-left"
              role="switch"
              aria-checked={announceOnly}
            >
              <span>
                <span className="block font-bold text-[#1A1A1A]">📢 Announcements only</span>
                <span className="block text-sm text-gray-500">Only leaders of this group can post.</span>
              </span>
              <span className={`h-7 w-12 rounded-full p-1 transition-colors ${announceOnly ? 'bg-burgundy' : 'bg-gray-300'}`}>
                <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${announceOnly ? 'translate-x-5' : ''}`} />
              </span>
            </button>

            {isOpen ? (
              <p className="text-sm text-gray-500 mt-4">This group is open to the whole church, so there’s no member list to manage.</p>
            ) : (
              <div className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-700">
                    Members{members ? ` (${members.length})` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAdd((v) => !v)}
                    className="min-h-[40px] px-3 rounded-xl text-sm font-bold text-burgundy"
                  >
                    {showAdd ? 'Done' : '+ Add people'}
                  </button>
                </div>
                {showAdd ? (
                  <div className="mb-3">
                    <PeoplePicker selected={adding} onChange={setAdding} channelId={channelId} />
                    {adding.length ? (
                      <button
                        type="button"
                        onClick={() => void addPeople()}
                        disabled={busy === 'add'}
                        className="mt-2 w-full min-h-[48px] rounded-xl bg-burgundy text-white font-bold disabled:opacity-60"
                      >
                        {busy === 'add' ? 'Adding…' : `Add ${adding.length} ${adding.length === 1 ? 'person' : 'people'}`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {members === null ? (
                  <p className="text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 className="animate-spin" size={16} /> Loading members…
                  </p>
                ) : (
                  <ul className="rounded-2xl bg-white border border-gray-100 divide-y divide-gray-100">
                    {members.map((p) => (
                      <li key={p.id} className="min-h-[56px] px-4 flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block font-semibold text-[#1A1A1A] truncate">
                            {p.name}
                            {p.id === selfId ? ' (you)' : ''}
                          </span>
                          {p.roomRole === 'admin' || p.isCreator ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-gold-ink">
                              <Shield size={12} aria-hidden /> Group admin
                            </span>
                          ) : p.fromMinistry ? (
                            <span className="text-xs text-gray-500">From the ministry list</span>
                          ) : null}
                        </span>
                        {p.id !== selfId && !p.isCreator ? (
                          <button
                            type="button"
                            onClick={() => void remove(p)}
                            disabled={busy === `rm-${p.id}`}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-red-700"
                            aria-label={`Remove ${p.name}`}
                          >
                            {busy === `rm-${p.id}` ? <Loader2 className="animate-spin" size={18} /> : <UserMinus size={18} />}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {error ? <p className="text-sm text-burgundy font-semibold mt-4">{error}</p> : null}
      </div>
    </div>
    </Portal>
  );
};
