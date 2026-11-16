/** Jordan home tabs: Prayer Gathering | Ministries | Messages | Live Huddles (URL + session). */

export type ChatHomeTab = 'prayer' | 'ministries' | 'messages' | 'huddles';

export const CHAT_HOME_TAB_ORDER: ChatHomeTab[] = ['prayer', 'ministries', 'messages', 'huddles'];

export const CHAT_HOME_TAB_KEY = 'plcc-jordan-home-tab';

export function parseChatHomeTab(value: string | null | undefined): ChatHomeTab {
  const v = String(value || '').toLowerCase();
  if (v === 'ministries' || v === 'channels' || v === 'ministry') return 'ministries';
  if (v === 'messages' || v === 'dms' || v === 'direct') return 'messages';
  if (v === 'huddles' || v === 'live' || v === 'huddle') return 'huddles';
  return 'prayer';
}

export function readStoredChatHomeTab(): ChatHomeTab | null {
  try {
    const v = sessionStorage.getItem(CHAT_HOME_TAB_KEY);
    return v ? parseChatHomeTab(v) : null;
  } catch {
    return null;
  }
}

export function storeChatHomeTab(tab: ChatHomeTab): void {
  try {
    sessionStorage.setItem(CHAT_HOME_TAB_KEY, tab);
  } catch {
    /* private mode */
  }
}
