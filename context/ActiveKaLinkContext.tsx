import { AppCrashBoundary } from '../components/routing/AppCrashBoundary.jsx';
import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Radio, X } from 'lucide-react';
import { useAuth } from './AuthContext';
import {
  KA_LINK_SESSION_KEY,
  historyStateHasKaLink,
  parseKaLinkSession,
  serializeKaLinkSession,
  withKaLinkHistoryFlag,
  type KaLinkSession,
} from '../lib/kaLinkSession';

/**
 * The live Ka Link call lives HERE, above the router — not inside a chat page.
 *
 * Before (Phase 1 bug #2): the call was part of the chat room page, so pressing
 * the phone's Back button (or opening another page) unmounted the page and hung
 * up the call. Now pages only ask this provider to open the call; moving around
 * the app minimizes it to the floating bar and the call keeps going.
 */

export type ActiveKaLink = {
  channelId: string;
  channelName?: string;
  audioOnly?: boolean;
  mode: 'join' | 'start';
  /** Bumps to remount the call when switching rooms. */
  key: number;
};

type ActiveKaLinkContextValue = {
  active: ActiveKaLink | null;
  minimized: boolean;
  openKaLink: (opts: { channelId: string; channelName?: string; audioOnly?: boolean; mode: 'join' | 'start' }) => void;
};

// The call screen is large; download it only when a Ka Link is actually opened.
const ConnectVoiceHuddle = lazy(() =>
  import('../components/community/ConnectVoiceHuddle').then((m) => ({ default: m.ConnectVoiceHuddle }))
);

const ActiveKaLinkContext = createContext<ActiveKaLinkContextValue | null>(null);

function readStoredSession(): KaLinkSession | null {
  try {
    return parseKaLinkSession(window.localStorage.getItem(KA_LINK_SESSION_KEY));
  } catch {
    return null;
  }
}

function writeStoredSession(session: KaLinkSession | null) {
  try {
    if (session) window.localStorage.setItem(KA_LINK_SESSION_KEY, serializeKaLinkSession(session));
    else window.localStorage.removeItem(KA_LINK_SESSION_KEY);
  } catch {
    /* private mode */
  }
}

export const ActiveKaLinkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const userLabel = user ? String(user.phone || user.email || user.id || '') : null;
  const location = useLocation();
  const navigate = useNavigate();

  const [active, setActive] = useState<ActiveKaLink | null>(null);
  const [minimized, setMinimizedState] = useState(false);
  /** A call the phone dropped when it reloaded the app (e.g. after a phone call). */
  const [rejoinOffer, setRejoinOffer] = useState<KaLinkSession | null>(() =>
    typeof window === 'undefined' ? null : readStoredSession()
  );
  const keyRef = useRef(0);
  /** We just pushed the "Ka Link open" history entry and the router hasn't caught up yet. */
  const pushingRef = useRef(false);
  const locationRef = useRef(location);
  locationRef.current = location;

  const pushOpenEntry = useCallback(() => {
    const loc = locationRef.current;
    if (historyStateHasKaLink(loc.state)) return;
    pushingRef.current = true;
    navigate(`${loc.pathname}${loc.search}${loc.hash}`, { state: withKaLinkHistoryFlag(loc.state) });
  }, [navigate]);

  const popOpenEntry = useCallback(() => {
    if (historyStateHasKaLink(locationRef.current.state)) navigate(-1);
  }, [navigate]);

  const setMinimized = useCallback(
    (next: boolean) => {
      setMinimizedState(next);
      if (next) popOpenEntry();
      else pushOpenEntry();
    },
    [popOpenEntry, pushOpenEntry]
  );

  const openKaLink = useCallback<ActiveKaLinkContextValue['openKaLink']>(
    (opts) => {
      setRejoinOffer(null);
      if (active && active.channelId === opts.channelId) {
        setMinimized(false);
        return;
      }
      if (active) {
        const ok = window.confirm(
          `You are in another Ka Link${active.channelName ? ` (${active.channelName})` : ''}. Leave it and go to ${opts.channelName || 'this one'}?`
        );
        if (!ok) return;
      }
      keyRef.current += 1;
      setActive({ ...opts, key: keyRef.current });
      setMinimizedState(false);
      pushOpenEntry();
      writeStoredSession({ channelId: opts.channelId, channelName: opts.channelName, audioOnly: opts.audioOnly, at: Date.now() });
    },
    [active, pushOpenEntry, setMinimized]
  );

  const closeKaLink = useCallback(() => {
    setActive(null);
    setMinimizedState(false);
    writeStoredSession(null);
    popOpenEntry();
  }, [popOpenEntry]);

  // Phone Back button: the "Ka Link open" entry was popped → minimize, keep the call.
  useEffect(() => {
    const flagged = historyStateHasKaLink(location.state);
    if (flagged) {
      pushingRef.current = false;
      return;
    }
    if (pushingRef.current) return;
    if (active && !minimized) setMinimizedState(true);
  }, [active, location, minimized]);

  // Real sign-out ends the call and forgets it on this device.
  useEffect(() => {
    if (isAuthenticated) return;
    if (active) setActive(null);
  }, [active, isAuthenticated]);

  const value = useMemo<ActiveKaLinkContextValue>(
    () => ({ active, minimized, openKaLink }),
    [active, minimized, openKaLink]
  );

  return (
    <ActiveKaLinkContext.Provider value={value}>
      {children}
      {active && isAuthenticated ? (
        <AppCrashBoundary key={`crash-${active.key}`} area="call" identifier={userLabel} onCloseCall={closeKaLink}>
        <Suspense fallback={null}>
        <ConnectVoiceHuddle
          key={active.key}
          channelId={active.channelId}
          channelName={active.channelName}
          audioOnly={active.audioOnly}
          mode={active.mode}
          minimized={minimized}
          onMinimizedChange={setMinimized}
          onClose={closeKaLink}
        />
        </Suspense>
        </AppCrashBoundary>
      ) : null}
      {!active && rejoinOffer && isAuthenticated ? (
        <div className="pr-mini" role="region" aria-label="Rejoin Ka Link">
          <button
            type="button"
            className="pr-mini-main"
            onClick={() =>
              openKaLink({
                channelId: rejoinOffer.channelId,
                channelName: rejoinOffer.channelName,
                audioOnly: rejoinOffer.audioOnly,
                mode: 'join',
              })
            }
            aria-label="Rejoin Ka Link"
          >
            <span className="pr-mini-dot is-live" aria-hidden />
            <span className="min-w-0">
              <span className="pr-mini-title">Rejoin {rejoinOffer.channelName || 'Ka Link'}</span>
              <span className="pr-mini-sub">You were disconnected. Tap to go back in.</span>
            </span>
          </button>
          <button
            type="button"
            className="pr-mini-btn is-on"
            onClick={() =>
              openKaLink({
                channelId: rejoinOffer.channelId,
                channelName: rejoinOffer.channelName,
                audioOnly: rejoinOffer.audioOnly,
                mode: 'join',
              })
            }
            aria-label="Rejoin"
          >
            <Radio size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="pr-mini-btn"
            onClick={() => {
              setRejoinOffer(null);
              writeStoredSession(null);
            }}
            aria-label="Dismiss"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      ) : null}
    </ActiveKaLinkContext.Provider>
  );
};

export function useActiveKaLink(): ActiveKaLinkContextValue {
  const ctx = useContext(ActiveKaLinkContext);
  if (!ctx) {
    return { active: null, minimized: false, openKaLink: () => undefined };
  }
  return ctx;
}
