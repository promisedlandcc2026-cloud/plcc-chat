/** Ka Link bottom bar: where it shows and which item is lit. Pure, so it is easy to test. */
export type AppNavKey = 'chats' | 'messages' | 'live' | 'bible';

const NAV_PAGES = ['/community/chat', '/bible', '/live', '/music', '/issues'];

/**
 * Phones: on the main pages, but not inside an open conversation (it has Back + the message box).
 * Desktop chat: the bar sits under the chat list (inline), never over the open conversation.
 */
export function appNavVisible(pathname: string, opts: { desktop: boolean; inline?: boolean }): boolean {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  const inChat = path === '/community/chat' || path.startsWith('/community/chat/');
  if (opts.inline) return opts.desktop && inChat;
  if (opts.desktop && inChat) return false; // the inline bar under the list covers it
  if (path.startsWith('/community/chat/')) return false;
  return NAV_PAGES.includes(path);
}

export function appNavActive(pathname: string, search: string): AppNavKey | null {
  const path = String(pathname || '');
  if (path.startsWith('/bible')) return 'bible';
  if (path.startsWith('/live')) return 'live';
  if (!path.startsWith('/community/chat')) return null;
  const tab = new URLSearchParams(search || '').get('tab');
  if (tab === 'messages' || tab === 'dms') return 'messages';
  if (tab === 'huddles' || tab === 'live') return 'live';
  if (tab) return 'chats';
  // No ?tab: the list remembers the last tab; Messages/Live light up from it.
  try {
    const stored = sessionStorage.getItem('plcc-jordan-home-tab');
    if (stored === 'messages') return 'messages';
    if (stored === 'huddles') return 'live';
  } catch {
    /* private mode */
  }
  return 'chats';
}
