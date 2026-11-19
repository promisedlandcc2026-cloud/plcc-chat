import React from 'react';
import { isChunkLoadError, reloadOnceForNewVersion } from '../../lib/staleBuild';
import { reportSignInFailureOnce } from '../../lib/signInFailureReport';
import { KA_LINK_SESSION_KEY } from '../../lib/kaLinkSession';

/**
 * Last line of defence: a render error anywhere outside the per-page boundaries
 * (header, providers, the Ka Link call screen) used to unmount the whole app and
 * leave members on a blank screen. Now they see what happened and can recover,
 * and the church's "sign-in problems" log (Canaan) gets the error and phone type.
 *
 * No stack traces or tokens are sent: only the error name/message (200 chars max),
 * the page path and which part of the app failed.
 */
/*
 * Props:
 *  - identifier: who is signed in (phone, email or user id), for the church log
 *  - area: 'app' = whole screen (default); 'call' = the Ka Link call screen only
 *  - onCloseCall: for area="call", close the broken call and go back to the chats
 */

export function crashDetail(error, area, path) {
  const e = error;
  const name = String(e?.name || 'Error').slice(0, 40);
  const message = String(e?.message || error || '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim();
  return `[${area}] ${path} · ${name}: ${message}`.slice(0, 200);
}

export class AppCrashBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, updating: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // An old copy of the app asking for files a new deploy replaced: reload once.
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) {
      this.setState({ updating: true });
      return;
    }
    const area = this.props.area || 'app';
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    reportSignInFailureOnce({
      method: 'session',
      identifier: String(this.props.identifier || 'unknown'),
      reason: 'app_crash',
      detail: crashDetail(error, area, path),
    });
  }

  reload = () => {
    window.location.reload();
  };

  /** Forget the saved Ka Link (the usual thing that reopens a broken screen) and start again. */
  startFresh = () => {
    try {
      window.localStorage.removeItem(KA_LINK_SESSION_KEY);
    } catch {
      /* private mode */
    }
    window.location.assign('/community/chat');
  };

  closeCall = () => {
    this.setState({ error: null });
    this.props.onCloseCall?.();
  };

  render() {
    const { error, updating } = this.state;
    if (!error) return this.props.children;

    if (updating) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-6 text-center bg-white" role="status">
          <p className="text-sm text-gray-700">Updating PLCC Ka Link to the latest version…</p>
        </div>
      );
    }

    if (this.props.area === 'call') {
      return (
        <div className="fixed inset-x-3 bottom-4 z-[400] rounded-2xl bg-white p-4 shadow-2xl border border-gray-200" role="alert" data-testid="call-crash">
          <p className="font-bold text-[#1A1A1A]">The Ka Link screen stopped working.</p>
          <p className="mt-1 text-sm text-gray-600">Close it and join again from the room. The church has been told.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={this.closeCall} className="min-h-[44px] flex-1 rounded-xl bg-[#1d372c] px-4 text-sm font-bold text-white">
              Close
            </button>
            <button type="button" onClick={this.reload} className="min-h-[44px] flex-1 rounded-xl border border-gray-300 px-4 text-sm font-bold text-[#1A1A1A]">
              Reload
            </button>
          </div>
        </div>
      );
    }

    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 py-16 text-center bg-white" role="alert" data-testid="app-crash">
        <h1 className="text-xl font-bold text-[#1A1A1A]">PLCC Ka Link hit a problem</h1>
        <p className="max-w-sm text-sm leading-relaxed text-gray-600">
          Something on this phone stopped Ka Link from opening. Tap <strong>Reload</strong>. If it happens again, tap{' '}
          <strong>Start fresh</strong>. Your messages are safe, and the church has been told so it can be fixed.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={this.reload} className="min-h-[48px] rounded-2xl bg-[#1d372c] px-6 text-sm font-bold text-white">
            Reload
          </button>
          <button type="button" onClick={this.startFresh} className="min-h-[48px] rounded-2xl border border-gray-300 px-6 text-sm font-bold text-[#1A1A1A]">
            Start fresh
          </button>
        </div>
      </main>
    );
  }
}
