import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import {
  isDmChannel,
  isHuddleChannelLive,
  type HuddleChannelStatus,
} from '../lib/communityChatTypes';

type HuddleLiveContextValue = {
  byChannel: Record<string, HuddleChannelStatus>;
  anyLive: boolean;
  liveCount: number;
};

const HuddleLiveContext = createContext<HuddleLiveContextValue | null>(null);

const POLL_MS = 10_000;
const MAX_CHANNELS = 50;

async function loadHuddleClient() {
  return import('../lib/communityChatClient');
}

export const HuddleLiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, memberAccessState, user } = useAuth();
  const authUserId = user?.id || null;
  const enabled = Boolean(isAuthenticated && memberAccessState === 'approved_member' && authUserId);

  const [byChannel, setByChannel] = useState<Record<string, HuddleChannelStatus>>({});
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { fetchChatChannels, fetchHuddleStatuses } = await loadHuddleClient();
      const channels = await fetchChatChannels();
      if (signal?.aborted) return;
      const ids = channels
        .filter((c) => !isDmChannel(c))
        .map((c) => c.id)
        .slice(0, MAX_CHANNELS);
      if (ids.length === 0) {
        setByChannel({});
        return;
      }
      const next = await fetchHuddleStatuses(ids, { signal });
      if (signal?.aborted) return;
      setByChannel(next);
    } catch {
      /* Non-blocking — hide LIVE dots rather than break the shell. */
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setByChannel({});
      return;
    }
    const controller = new AbortController();
    void refresh(controller.signal);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [authUserId, enabled, refresh]);

  const liveCount = useMemo(() => {
    let n = 0;
    for (const status of Object.values(byChannel)) {
      if (isHuddleChannelLive(status)) n += 1;
    }
    return n;
  }, [byChannel]);

  const value = useMemo<HuddleLiveContextValue>(
    () => ({
      byChannel,
      anyLive: liveCount > 0,
      liveCount,
    }),
    [byChannel, liveCount]
  );

  return <HuddleLiveContext.Provider value={value}>{children}</HuddleLiveContext.Provider>;
};

export function useHuddleLive(): HuddleLiveContextValue {
  const ctx = useContext(HuddleLiveContext);
  if (!ctx) {
    return { byChannel: {}, anyLive: false, liveCount: 0 };
  }
  return ctx;
}
