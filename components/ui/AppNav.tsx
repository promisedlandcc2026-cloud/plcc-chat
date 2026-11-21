/**
 * Bottom bar on every Ka Link page (members asked: "if I am here, I can go there, and there").
 * Chats · Messages · Live · Bible · Apps. "Apps" switches to Tribes, PLCC Canaan or all PLCC apps
 * with the same sign-in. Hidden inside an open conversation on phones (that screen has its own
 * Back and message box), like WhatsApp.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, ExternalLink, LayoutGrid, MessageCircle, MessagesSquare, Radio, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useActiveKaLink } from '../../context/ActiveKaLinkContext';
import { useDmCall } from '../../context/DmCallContext';
import { AWC_ONE_URL, CONNECT_URL, VAULT_URL } from '../../lib/appLinks';
import { appNavActive, appNavVisible, type AppNavKey } from '../../lib/appNav';
import { isCallActive } from '../../lib/staleBuild';

const ITEMS: Array<{ key: AppNavKey; label: string; to: string; Icon: typeof MessageCircle }> = [
  { key: 'chats', label: 'Chats', to: '/community/chat?tab=prayer', Icon: MessageCircle },
  { key: 'messages', label: 'Messages', to: '/community/chat?tab=messages', Icon: MessagesSquare },
  { key: 'live', label: 'Live', to: '/community/chat?tab=huddles', Icon: Radio },
  { key: 'bible', label: 'Bible', to: '/bible', Icon: BookOpen },
];

const APPS = [
  { label: 'Tribes', note: 'Posts, events, giving and your church family', href: CONNECT_URL },
  { label: 'PLCC Canaan', note: 'Your profile, account and church records', href: VAULT_URL },
  { label: 'All PLCC apps', note: 'The PLCC ONE home screen', href: AWC_ONE_URL },
];

export const AppNav: React.FC<{ desktopChat?: boolean }> = ({ desktopChat }) => {
  const location = useLocation();
  const { memberAccessState } = useAuth();
  const [appsOpen, setAppsOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches === true);
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 1024px)');
    if (!mq) return;
    const on = () => setDesktop(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  // A full-screen call (prayer room or private call) owns the screen; the bar comes back when minimized.
  const { active: kaLink, minimized: kaLinkMinimized } = useActiveKaLink();
  const dm = useDmCall();
  const callCoversScreen = (Boolean(kaLink) && !kaLinkMinimized) || Boolean(dm && dm.call.phase !== 'idle' && !dm.call.minimized);
  const visible =
    memberAccessState === 'approved_member' &&
    !callCoversScreen &&
    appNavVisible(location.pathname, { desktop: Boolean(desktop), inline: Boolean(desktopChat) });

  // Pages that cover the whole screen (the Bible) leave room for the bar.
  useEffect(() => {
    if (desktopChat) return;
    document.body.classList.toggle('has-app-nav', visible);
    return () => document.body.classList.remove('has-app-nav');
  }, [desktopChat, visible]);

  if (!visible) return null;
  const active = appNavActive(location.pathname, location.search);

  const bar = (
    <nav
      aria-label="Ka Link"
      data-testid="app-nav"
      className={`ka-link-bottom-nav ${
        desktopChat ? 'sticky bottom-0' : 'fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] lg:max-w-[1400px]'
      } z-[460] bg-white/95 backdrop-blur border-t border-gray-200 pb-[env(safe-area-inset-bottom)]`}
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map(({ key, label, to, Icon }) => {
          const on = active === key;
          return (
            <li key={key}>
              <Link
                to={to}
                aria-current={on ? 'page' : undefined}
                className="ka-link-nav-item flex flex-col items-center justify-center gap-0.5 min-h-[58px] text-[11px] font-bold"
              >
                <span className={`flex items-center justify-center h-7 w-12 rounded-full ${on ? 'bg-gold/30' : ''}`}>
                  <Icon size={20} aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setAppsOpen(true)}
            className="ka-link-nav-item w-full flex flex-col items-center justify-center gap-0.5 min-h-[58px] text-[11px] font-bold"
            aria-haspopup="dialog"
            data-testid="app-nav-apps"
          >
            <span className="flex items-center justify-center h-7 w-12 rounded-full">
              <LayoutGrid size={20} aria-hidden />
            </span>
            Apps
          </button>
        </li>
      </ul>
    </nav>
  );

  return (
    <>
      {desktopChat ? bar : <div aria-hidden className="h-[calc(58px+env(safe-area-inset-bottom))] shrink-0" />}
      {desktopChat ? null : createPortal(bar, document.body)}
      {appsOpen
        ? createPortal(
            <div className="fixed inset-0 z-[470] bg-black/40 flex items-end lg:items-center justify-center" onClick={() => setAppsOpen(false)}>
              <div
                className="w-full max-w-[500px] lg:max-w-[420px] bg-white rounded-t-3xl lg:rounded-3xl shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
                role="dialog"
                aria-modal="true"
                aria-label="Other PLCC apps"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 pt-5 pb-2">
                  <p className="text-lg font-bold text-[#1A1A1A]">PLCC apps</p>
                  <button type="button" onClick={() => setAppsOpen(false)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500" aria-label="Close">
                    <X size={20} />
                  </button>
                </div>
                <p className="px-5 pb-3 text-sm text-gray-500">Same sign-in everywhere. During a call they open in a new tab, so your call keeps going.</p>
                <ul>
                  {APPS.map((a) => (
                    <li key={a.label}>
                      <a
                        href={a.href}
                        onClick={(e) => {
                          // Leaving this page would hang up a call: open the other app beside it instead.
                          if (isCallActive()) {
                            e.preventDefault();
                            window.open(a.href, '_blank', 'noopener');
                          }
                        }}
                        className="flex items-center justify-between gap-3 px-5 min-h-[64px] border-t border-gray-100 active:bg-gray-50">
                        <span>
                          <span className="block font-bold text-[#1A1A1A]">{a.label}</span>
                          <span className="block text-xs text-gray-500">{a.note}</span>
                        </span>
                        <ExternalLink size={18} className="text-burgundy shrink-0" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
};
