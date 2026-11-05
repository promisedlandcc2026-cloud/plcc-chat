import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, ChevronDown, ExternalLink, Loader2, LogOut, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { CONNECT_URL, VAULT_URL } from '../../lib/appLinks';
import {
  type AlertsState,
  getAlertsState,
  onAlertsStateChange,
  turnOffAlerts,
  turnOnAlerts,
} from '../../lib/phoneAlerts';
import { Portal } from './Portal';

function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Me';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "Message alerts" on/off for this phone or computer. Hidden where alerts can't work. */
const AlertsRow: React.FC = () => {
  const [state, setState] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAlertsState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ kind: 'off' }));
    const stop = onAlertsStateChange((s) => alive && setState(s));
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (state && (state.kind === 'unsupported' || state.kind === 'not-set-up' || state.kind === 'signed-out')) {
    return null;
  }

  const on = state?.kind === 'on';
  const canToggle = state?.kind === 'on' || state?.kind === 'off';
  const hint =
    state == null
      ? 'Checking…'
      : state.kind === 'needs-install'
        ? 'On iPhone, add PLCC Chat to your Home Screen first, then turn this on there.'
        : state.kind === 'blocked'
          ? 'Blocked. Allow notifications for this site in your phone or browser settings.'
          : on
            ? 'You’ll get a notification for new messages on this device.'
            : 'Get a notification on this device when someone messages you.';

  const toggle = async () => {
    if (!canToggle || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const next = on ? await turnOffAlerts() : await turnOnAlerts();
      setState(next);
      if (!on && next.kind === 'off') setNote('Alerts weren’t allowed. Tap again and choose “Allow”.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not change alerts.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-3 border-b border-gray-100">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!canToggle || busy}
        onClick={() => void toggle()}
        className="w-full min-h-[48px] flex items-center justify-between gap-3 text-left disabled:cursor-default"
      >
        <span className="flex items-start gap-3 min-w-0">
          <BellRing size={20} className="text-burgundy shrink-0 mt-0.5" aria-hidden />
          <span className="min-w-0">
            <span className="block text-base font-semibold text-[#1A1A1A]">Message alerts</span>
            <span className="block text-xs text-gray-500">{hint}</span>
          </span>
        </span>
        {canToggle ? (
          <span
            className={`shrink-0 h-7 w-12 rounded-full p-1 transition-colors ${on ? 'bg-burgundy' : 'bg-gray-300'} ${busy ? 'opacity-60' : ''}`}
            aria-hidden
          >
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
          </span>
        ) : null}
      </button>
      {note ? <p className="text-xs text-burgundy mt-1">{note}</p> : null}
    </div>
  );
};

/** Your name + menu: message alerts, open PLCC Connect, open the Vault, sign out. */
export const AccountMenu: React.FC = () => {
  const { identity, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      // This phone stops getting chat alerts for this account.
      await turnOffAlerts().catch(() => null);
      await signOut();
      navigate('/signed-out', { replace: true });
    } catch {
      setError('We could not sign you out. Please try again.');
      setBusy(false);
    }
  };

  const linkRow =
    'w-full min-h-[56px] flex items-center justify-between gap-3 px-5 text-base font-semibold text-[#1A1A1A] active:bg-gray-50 hover:bg-gray-50';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 min-h-[44px] pl-1 pr-2.5 rounded-full border border-gray-200 bg-white shadow-sm hover:bg-gray-50 active:bg-gray-50"
        aria-label="Your account: PLCC Connect, PLCC Canaan, and sign out"
        aria-haspopup="dialog"
      >
        <span className="h-9 w-9 rounded-full bg-burgundy text-white text-sm font-bold flex items-center justify-center">
          {initials(identity?.name)}
        </span>
        <span className="text-sm font-bold text-[#1A1A1A]">Account</span>
        <ChevronDown size={14} className="text-gray-500" aria-hidden />
      </button>

      {open ? (
        <Portal>
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-[500px] lg:max-w-[420px] bg-white rounded-t-3xl lg:rounded-3xl shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Your account"
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
              <span className="h-12 w-12 rounded-full bg-burgundy text-white font-bold flex items-center justify-center">
                {initials(identity?.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[#1A1A1A] truncate">{identity?.name || 'Signed in'}</p>
                {identity?.email ? <p className="text-sm text-gray-500 truncate">{identity.email}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <AlertsRow />

            <a href={CONNECT_URL} className={linkRow}>
              <span>Open PLCC Connect</span>
              <ExternalLink size={18} className="text-burgundy" aria-hidden />
            </a>
            <a href={VAULT_URL} className={linkRow}>
              <span>
                Open the PLCC Canaan
                <span className="block text-xs font-medium text-gray-500">Your profile and account settings</span>
              </span>
              <ExternalLink size={18} className="text-burgundy" aria-hidden />
            </a>

            <div className="px-5 pt-3">
              <button
                type="button"
                onClick={() => void doSignOut()}
                disabled={busy}
                className="w-full min-h-[52px] rounded-2xl border-2 border-burgundy text-burgundy font-extrabold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {busy ? <Loader2 className="animate-spin" size={18} /> : <LogOut size={18} aria-hidden />}
                Sign out of PLCC Chat
              </button>
              {error ? <p className="text-sm text-burgundy mt-2">{error}</p> : null}
              <p className="text-xs text-gray-500 mt-2 text-center">
                Signing out here doesn’t sign you out of Connect or PLCC Canaan.
              </p>
            </div>
          </div>
        </div>
        </Portal>
      ) : null}
    </>
  );
};
