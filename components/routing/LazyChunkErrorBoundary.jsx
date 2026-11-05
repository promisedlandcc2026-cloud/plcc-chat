import React from 'react';
import { Link } from 'react-router-dom';
import { isChunkLoadError, reloadOnceForNewVersion } from '../../lib/staleBuild';

/**
 * Catches failed dynamic imports / render errors for lazy routes.
 * Offers Retry and Home — no infinite reload, no stack traces.
 *
 * Out-of-date app (a deploy replaced the script files): reload once
 * automatically; Retry does a full reload, because React.lazy keeps the
 * failed import until the page reloads.
 */
export class LazyChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, staleBuild: false, updating: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, staleBuild: isChunkLoadError(error) };
  }

  componentDidCatch(error, _info) {
    // Intentionally no stack/token logging
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) {
      this.setState({ updating: true });
    }
  }

  // Always a full reload: React.lazy keeps a failed download, so resetting
  // state alone can never recover (old open tabs, a dropped connection, etc.).
  retry = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError && this.state.updating) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-24 min-h-[50vh] text-center" role="status">
          <p className="text-sm text-gray-600">Updating Connect to the latest version…</p>
        </div>
      );
    }
    if (this.state.hasError) {
      const section = this.props.sectionLabel || 'this section';
      return (
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-24 min-h-[50vh] text-center max-w-md mx-auto">
          <h1 className="text-lg font-bold text-[#1A1A1A]">Couldn’t load {section}</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            {this.state.staleBuild
              ? 'Connect was just updated. Tap Retry to load the latest version.'
              : 'Please check your connection and try again. You can still use the rest of Connect.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.retry}
              className="min-h-[44px] px-5 rounded-2xl bg-burgundy text-white text-sm font-bold"
            >
              Retry
            </button>
            <Link
              to="/"
              className="min-h-[44px] px-5 inline-flex items-center rounded-2xl border border-gray-200 bg-white text-burgundy text-sm font-bold"
            >
              Return Home
            </Link>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
