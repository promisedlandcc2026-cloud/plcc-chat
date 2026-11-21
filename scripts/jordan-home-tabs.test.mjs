import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChatHomeTab, resolveChatHomeTab, CHAT_HOME_TAB_ORDER } from '../lib/chatHomeTabs.ts';
import { matchPrayerGatherings, prayerGatheringRoomIds, PRAYER_GATHERINGS } from '../lib/prayerGatherings.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Jordan home tabs', () => {
  it('parses tab ids (Prayer is the default)', () => {
    assert.equal(parseChatHomeTab(null), 'prayer');
    assert.equal(parseChatHomeTab('channels'), 'ministries');
    assert.equal(parseChatHomeTab('ministries'), 'ministries');
    assert.equal(parseChatHomeTab('dms'), 'messages');
    assert.equal(parseChatHomeTab('live'), 'huddles');
    assert.equal(parseChatHomeTab('nope'), 'prayer');
    assert.deepEqual(CHAT_HOME_TAB_ORDER, ['prayer', 'ministries', 'messages', 'huddles']);
  });

  it('shows Messages for an open DM despite stale Live selection and preserves intentional Live elsewhere', () => {
    assert.equal(resolveChatHomeTab('huddles','huddles',true),'messages');
    assert.equal(resolveChatHomeTab('messages','huddles',true),'messages');
    assert.equal(resolveChatHomeTab(null,'huddles',true),'messages');
    assert.equal(resolveChatHomeTab('huddles','messages',false),'huddles');
  });

  it('lists the five gatherings in order', () => {
    assert.deepEqual(
      PRAYER_GATHERINGS.map((g) => g.name),
      ['Morning Glory', 'Lunch Hour', 'Midnight Watch', 'Upper Room', 'Intercessors']
    );
  });

  it('matches rooms by name (any capitals/spacing) and Intercessors by the Vault room id', () => {
    const rooms = [
      { id: 'a', name: 'MORNING  glory' },
      { id: 'b', name: 'Choir' },
      { id: 'c', name: 'Midnight Watch!' },
      { id: 'i', name: 'Intercessor Channel' },
    ];
    const m = matchPrayerGatherings(rooms, 'i');
    assert.equal(m['morning-glory']?.id, 'a');
    assert.equal(m['midnight-watch']?.id, 'c');
    assert.equal(m['lunch-hour'], null);
    assert.equal(m['upper-room'], null);
    assert.equal(m.intercessors?.id, 'i');
    assert.deepEqual([...prayerGatheringRoomIds(m)].sort(), ['a', 'c', 'i']);
    // Without the Vault id, the room still matches by name; members who cannot open it never get it in their list.
    assert.equal(matchPrayerGatherings(rooms, null).intercessors?.id, 'i'); // "Intercessor Channel" alias
    assert.equal(matchPrayerGatherings([{ id: 'x', name: 'Other' }], null).intercessors, null);
  });

  it('wires four tab panels on the home list', () => {
    const list = readFileSync(join(root, 'pages/CommunityChat.tsx'), 'utf8');
    assert.ok(list.includes('<ChatNavTabs'));
    for (const id of ['prayer', 'ministries', 'messages', 'huddles']) {
      assert.ok(list.includes(`activeTab === '${id}'`), id);
      assert.ok(list.includes(`id="chat-panel-${id}"`), id);
    }
    assert.ok(list.includes('storeChatHomeTab'));
    assert.ok(list.includes("huddleRoomPath(row.id, 'join')"));
  });
});
