import React, { useEffect, useState } from 'react';
import { BellRing, Loader2, X } from 'lucide-react';
import {
  type AlertsState,
  dismissNudge,
  getAlertsState,
  nudgeDismissed,
  onAlertsStateChange,
  sendTestAlert,
  turnOffAlerts,
  turnOnAlerts,
} from '../../lib/phoneAlerts';

/**
 * "Get a phone alert for every new message" — top of the chat list.
 * Hidden once alerts are on (a small line lets people turn them off or test).
 */
export const ChatAlertsCard: React.FC = () => {
  const [state, setState] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => nudgeDismissed());

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

  if (!state || state.kind === 'unsupported' || state.kind === 'not-set-up' || state.kind === 'signed-out') return null;

  if (state.kind === 'on') {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <BellRing size={14} className="text-emerald-600" aria-hidden />
          Phone alerts are on for new messages.
        </span>
        <button
          type="button"
          className="font-bold text-burgundy underline min-h-[32px]"
          onClick={async () => {
            setNote(null);
            try {
              const n = await sendTestAlert();
              setNote(n > 0 ? 'Test alert sent.' : 'No phones received it — try turning alerts off and on.');
            } catch {
              setNote('Could not send a test alert.');
            }
          }}
        >
          Send a test
        </button>
        <button
          type="button"
          className="font-bold text-burgundy underline min-h-[32px]"
          onClick={async () => setState(await turnOffAlerts())}
        >
          Turn off
        </button>
        {note ? <span className="w-full">{note}</span> : null}
      </div>
    );
  }

  if (hidden) return null;

  const body =
    state.kind === 'needs-install'
      ? 'On iPhone, alerts work from the Home Screen app: tap Share, then “Add to Home Screen”, then open PLCC Chat from that icon.'
      : state.kind === 'blocked'
        ? 'Alerts are blocked for PLCC Chat. Allow notifications for this site in your phone or browser settings, then come back.'
        : 'Get a notification on this phone when someone sends a message — just like WhatsApp.';

  return (
    <div className="mb-5 rounded-3xl bg-wine text-cream p-4 shadow-lg relative">
      <button
        type="button"
        onClick={() => {
          dismissNudge();
          setHidden(true);
        }}
        className="absolute top-2 right-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-cream/70"
        aria-label="Not now"
      >
        <X size={18} />
      </button>
      <p className="font-bold flex items-center gap-2 pr-8">
        <BellRing size={18} className="text-gold" aria-hidden />
        Turn on message alerts
      </p>
      <p className="text-sm text-cream/85 mt-1">{body}</p>
      {state.kind === 'off' ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote(null);
            try {
              const next = await turnOnAlerts();
              setState(next);
              if (next.kind === 'off') setNote('Alerts weren’t allowed. Tap again and choose “Allow”.');
            } catch (err) {
              setNote(err instanceof Error ? err.message : 'Could not turn on alerts.');
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 w-full min-h-[52px] rounded-2xl bg-gold text-wine font-extrabold text-base flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {busy ? <Loader2 className="animate-spin" size={18} /> : null}
          Turn on alerts
        </button>
      ) : null}
      {note ? <p className="text-sm mt-2 text-cream">{note}</p> : null}
    </div>
  );
};
