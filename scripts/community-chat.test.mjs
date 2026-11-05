/**
 * Phase — Community chat sanitize / URL tests (channels, DMs, huddle start/end).
 * Run: node --test scripts/test-community-chat.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAT_MESSAGE_MAX_CHARS,
  parseChatMessagesListQuery,
  parseChatUnreadQuery,
  parseDirectoryQuery,
  parseHuddleEndCommand,
  parseHuddleStatusQuery,
  parseHuddleTokenCommand,
  parseMarkChatReadCommand,
  parseOpenDmCommand,
  parseReportMessageCommand,
  parseSendChatMessageCommand,
  parseVaultChatChannelsResponse,
  parseVaultChatMessageMutationResponse,
  parseVaultChatMessagesResponse,
  parseVaultChatUnreadResponse,
  parseVaultDirectoryResponse,
  parseVaultDmChannelResponse,
  parseVaultHuddleEndResponse,
  parseVaultHuddleStatusesResponse,
  parseVaultHuddleTokenResponse,
  sanitizeChatChannel,
  sanitizeChatMessage,
  validateConnectChatContent,
} from '../api/_utils/communityChatSanitize.js';
import {
  buildVaultCommunityChatChannelsUrl,
  buildVaultCommunityChatDmChannelUrl,
  buildVaultCommunityChatHuddleStatusesUrl,
  buildVaultCommunityChatMarkReadUrl,
  buildVaultCommunityChatMentorsUrl,
  buildVaultCommunityChatMessagesUrl,
  buildVaultCommunityChatUnreadUrl,
  buildVaultCommunityChatVoiceEndUrl,
  buildVaultCommunityChatVoiceTokenUrl,
  VAULT_COMMUNITY_CHAT_CHANNELS_PATH,
  VAULT_COMMUNITY_CHAT_DM_CHANNEL_PATH,
  VAULT_COMMUNITY_CHAT_HUDDLE_STATUSES_PATH,
  VAULT_COMMUNITY_CHAT_MENTORS_PATH,
  VAULT_COMMUNITY_CHAT_MESSAGES_PATH,
  VAULT_COMMUNITY_CHAT_VOICE_END_PATH,
  VAULT_COMMUNITY_CHAT_VOICE_TOKEN_PATH,
} from '../api/_utils/vaultOrigin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const CHANNEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('buildVaultCommunityChat URLs', () => {
  it('uses fixed chat paths only', () => {
    const channels = buildVaultCommunityChatChannelsUrl('https://vault.example.com/');
    assert.ok(channels.includes(VAULT_COMMUNITY_CHAT_CHANNELS_PATH));

    const list = buildVaultCommunityChatMessagesUrl('https://vault.example.com/', CHANNEL_ID);
    assert.ok(list.includes(VAULT_COMMUNITY_CHAT_MESSAGES_PATH));
    assert.ok(list.includes(`channelId=${CHANNEL_ID}`));

    const post = buildVaultCommunityChatMessagesUrl('https://vault.example.com/');
    assert.equal(post, `https://vault.example.com${VAULT_COMMUNITY_CHAT_MESSAGES_PATH}`);

    assert.ok(buildVaultCommunityChatUnreadUrl('https://vault.example.com').includes('unread-count'));
    assert.ok(buildVaultCommunityChatMarkReadUrl('https://vault.example.com').includes('mark-read'));

    const mentors = buildVaultCommunityChatMentorsUrl('https://vault.example.com/');
    assert.ok(mentors.includes(VAULT_COMMUNITY_CHAT_MENTORS_PATH));
    assert.equal(mentors.includes('email'), false);

    const dm = buildVaultCommunityChatDmChannelUrl('https://vault.example.com/', USER_ID);
    assert.ok(dm.includes(VAULT_COMMUNITY_CHAT_DM_CHANNEL_PATH));
    assert.ok(dm.includes(`partnerId=${USER_ID}`));
  });

  it('builds huddle status + voice-token + voice-end URLs (no mod)', () => {
    const statuses = buildVaultCommunityChatHuddleStatusesUrl(
      'https://vault.example.com/',
      `${CHANNEL_ID},${MESSAGE_ID}`
    );
    assert.ok(statuses.includes(VAULT_COMMUNITY_CHAT_HUDDLE_STATUSES_PATH));
    assert.ok(statuses.includes('channelIds='));
    assert.equal(statuses.includes('voice-huddle-mod'), false);

    const tokenUrl = buildVaultCommunityChatVoiceTokenUrl('https://vault.example.com/');
    assert.equal(tokenUrl, `https://vault.example.com${VAULT_COMMUNITY_CHAT_VOICE_TOKEN_PATH}`);
    assert.ok(tokenUrl.includes('voice-token'));
    assert.equal(tokenUrl.includes('LIVEKIT'), false);

    const endUrl = buildVaultCommunityChatVoiceEndUrl('https://vault.example.com/');
    assert.equal(endUrl, `https://vault.example.com${VAULT_COMMUNITY_CHAT_VOICE_END_PATH}`);
    assert.ok(endUrl.includes('voice-huddle-end'));
    assert.equal(endUrl.includes('voice-huddle-mod'), false);
  });
});

describe('query + command parsers', () => {
  it('accepts channelId list query only', () => {
    assert.deepEqual(parseChatMessagesListQuery({ channelId: CHANNEL_ID }), {
      ok: true,
      channelId: CHANNEL_ID,
    });
    assert.equal(parseChatMessagesListQuery({}).ok, false);
    assert.equal(parseChatMessagesListQuery({ channelId: CHANNEL_ID, x: '1' }).ok, false);
  });

  it('rejects unread query extras', () => {
    assert.equal(parseChatUnreadQuery({}).ok, true);
    assert.equal(parseChatUnreadQuery({ since: 'x' }).ok, false);
  });

  it('maps send + mark-read commands', () => {
    assert.deepEqual(
      parseSendChatMessageCommand({ channelId: CHANNEL_ID, content: '  Hello  ' }),
      { ok: true, channelId: CHANNEL_ID, content: 'Hello', parentId: null, mentionedUserIds: [] }
    );
    assert.equal(
      parseSendChatMessageCommand({
        channelId: CHANNEL_ID,
        content: 'hi',
        user_id: USER_ID,
      }).ok,
      false
    );
    assert.equal(
      parseSendChatMessageCommand({
        channelId: CHANNEL_ID,
        content: 'x'.repeat(CHAT_MESSAGE_MAX_CHARS + 1),
      }).ok,
      false
    );
    assert.deepEqual(parseMarkChatReadCommand({ channelId: CHANNEL_ID }), {
      ok: true,
      channelId: CHANNEL_ID,
    });
  });

  it('validates content', () => {
    assert.equal(validateConnectChatContent('  ok  ').ok, true);
    assert.equal(validateConnectChatContent('   ').ok, false);
  });
});

describe('sanitize channel + message', () => {
  it('keeps presentation fields and allows DMs without secrets', () => {
    const open = sanitizeChatChannel({
      id: CHANNEL_ID,
      name: 'General',
      description: 'Hello',
      visibility: 'open',
      type: 'public',
      participants: [USER_ID],
      created_by: USER_ID,
      email: 'x@y.com',
    });
    assert.ok(open);
    assert.equal(open.name, 'General');
    assert.equal('participants' in open, false);
    assert.equal('created_by' in open, false);
    assert.equal(open.ministryId, null);

    const dm = sanitizeChatChannel({
      id: CHANNEL_ID,
      name: 'DM_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      visibility: 'dm',
      participants: [USER_ID],
      email: 'x@y.com',
    });
    assert.ok(dm);
    assert.equal(dm.visibility, 'dm');
    assert.equal(dm.name, 'Direct message');
    assert.equal('email' in dm, false);
    assert.equal('participants' in dm, false);
  });

  it('sanitizes messages, summarizes reactions, drops malformed attachments', () => {
    const msg = sanitizeChatMessage({
      id: MESSAGE_ID,
      channel_id: CHANNEL_ID,
      content: 'Peace',
      created_at: '2026-09-01T12:00:00.000Z',
      user_id: USER_ID,
      user_name: 'Jane',
      avatar_url: 'https://cdn.example.com/a.png',
      reactions: [{ user_id: USER_ID, emoji: '❤️' }],
      attachments: [{ storage_path: 'secret' }],
      email: 'secret@example.com',
    });
    assert.ok(msg);
    assert.equal(msg.content, 'Peace');
    assert.equal(msg.author.id, USER_ID);
    // reactions are summarized per emoji (only the allowed set, only real user ids)
    assert.deepEqual(msg.reactions, [{ emoji: '❤️', userIds: [USER_ID] }]);
    // malformed attachment (no id / no signed link) is dropped; storage paths never leak
    assert.deepEqual(msg.attachments, []);
    assert.equal('email' in msg, false);
  });

  it('maps list and mutation responses', () => {
    const list = parseVaultChatMessagesResponse([
      {
        id: MESSAGE_ID,
        channel_id: CHANNEL_ID,
        content: 'Hi',
        created_at: '2026-09-01T12:00:00.000Z',
        user_id: USER_ID,
        user_name: 'Jane',
      },
      { id: 'bad' },
    ]);
    assert.equal(list.ok, true);
    assert.equal(list.messages.length, 1);
    assert.equal(list.skipped, 1);

    const channels = parseVaultChatChannelsResponse([
      { id: CHANNEL_ID, name: 'General', visibility: 'open' },
      {
        id: MESSAGE_ID,
        name: 'DM_x',
        visibility: 'dm',
      },
    ]);
    assert.equal(channels.ok, true);
    assert.equal(channels.channels.length, 2);
    assert.equal(channels.channels[1].visibility, 'dm');
    assert.equal(channels.channels[1].name, 'Direct message');

    const created = parseVaultChatMessageMutationResponse({
      id: MESSAGE_ID,
      channel_id: CHANNEL_ID,
      content: 'New',
      created_at: '2026-09-01T12:00:00.000Z',
      user_id: USER_ID,
      user_name: 'Jane',
    });
    assert.equal(created.ok, true);
    assert.equal(created.message.content, 'New');

    const unread = parseVaultChatUnreadResponse({
      count: 3,
      byChannel: { [CHANNEL_ID]: 2, notauuid: 9 },
    });
    assert.equal(unread.ok, true);
    assert.equal(unread.count, 3);
    assert.equal(unread.byChannel[CHANNEL_ID], 2);
    assert.equal(unread.byChannel.notauuid, undefined);
  });
});

describe('huddle status + token sanitize', () => {
  it('parses huddle-status query and rejects junk', () => {
    assert.deepEqual(parseHuddleStatusQuery({ channelIds: CHANNEL_ID }), {
      ok: true,
      channelIds: [CHANNEL_ID],
    });
    assert.equal(parseHuddleStatusQuery({}).ok, false);
    assert.equal(parseHuddleStatusQuery({ channelIds: CHANNEL_ID, x: '1' }).ok, false);
    assert.equal(parseHuddleStatusQuery({ channelIds: 'not-uuid' }).ok, false);
  });

  it('parses huddle-token command (channelId only)', () => {
    assert.deepEqual(parseHuddleTokenCommand({ channelId: CHANNEL_ID }), {
      ok: true,
      channelId: CHANNEL_ID,
    });
    assert.equal(
      parseHuddleTokenCommand({ channelId: CHANNEL_ID, role: 'admin' }).ok,
      false
    );
  });

  it('treats live + participantCount > 0 as the visible LIVE mark', () => {
    const types = readFileSync(join(root, 'lib/communityChatTypes.ts'), 'utf8');
    assert.match(types, /isHuddleChannelLive/);
    assert.match(types, /s\.live/);
    assert.match(types, /participantCount/);
  });

  it('maps status live/participantCount and drops extras', () => {
    const parsed = parseVaultHuddleStatusesResponse(
      {
        ok: true,
        configured: true,
        byChannel: {
          [CHANNEL_ID]: {
            active: true,
            participantCount: 4,
            roomName: 'secret-room',
            hostId: USER_ID,
          },
          'not-a-uuid': { active: true, participantCount: 9 },
        },
        warning: 'ignore',
      },
      [CHANNEL_ID, MESSAGE_ID]
    );
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.byChannel[CHANNEL_ID], {
      live: true,
      participantCount: 4,
    });
    assert.deepEqual(parsed.byChannel[MESSAGE_ID], {
      live: false,
      participantCount: 0,
    });
    assert.equal(parsed.byChannel['not-a-uuid'], undefined);
    assert.equal('roomName' in parsed.byChannel[CHANNEL_ID], false);
    assert.equal('hostId' in parsed.byChannel[CHANNEL_ID], false);
  });

  it('sanitizes voice-token payload and rejects secrets / bad URLs', () => {
    const ok = parseVaultHuddleTokenResponse({
      ok: true,
      token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
      url: 'wss://livekit.example.com',
      roomName: 'voice_' + CHANNEL_ID,
      expiresIn: 3600,
      canModerate: false,
      channelCanModerate: true,
      hostId: USER_ID,
      coHostIds: [USER_ID],
      channelId: CHANNEL_ID,
      channelName: 'General',
      LIVEKIT_API_SECRET: 'must-not-leak',
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.token, {
      token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
      url: 'wss://livekit.example.com/',
      roomName: 'voice_' + CHANNEL_ID,
      expiresIn: 3600,
      canModerate: false,
      channelId: CHANNEL_ID,
      channelName: 'General',
    });
    assert.equal('hostId' in ok.token, false);
    assert.equal('LIVEKIT_API_SECRET' in ok.token, false);
    assert.equal('channelCanModerate' in ok.token, false);

    assert.equal(
      parseVaultHuddleTokenResponse({
        ok: true,
        token: 't',
        url: 'http://insecure.example',
        roomName: 'r',
        channelId: CHANNEL_ID,
      }).ok,
      false
    );
    assert.equal(
      parseVaultHuddleTokenResponse({
        ok: true,
        token: 'LIVEKIT_API_SECRET=abc',
        url: 'wss://livekit.example.com',
        roomName: 'r',
        channelId: CHANNEL_ID,
      }).ok,
      false
    );
  });
});

describe('Connect huddle bridge + UI wiring', () => {
  it('allows huddle resources including end; never forwards mod', () => {
    const bridge = readFileSync(join(root, 'api/community-chat.js'), 'utf8');
    const origin = readFileSync(join(root, 'api/_utils/vaultOrigin.js'), 'utf8');
    assert.ok(bridge.includes("'huddle-status'"));
    assert.ok(bridge.includes("'huddle-token'"));
    assert.ok(bridge.includes("'huddle-end'"));
    assert.ok(bridge.includes("'directory'"));
    assert.ok(bridge.includes("'dm'"));
    assert.ok(bridge.includes('buildVaultCommunityChatHuddleStatusesUrl'));
    assert.ok(bridge.includes('buildVaultCommunityChatVoiceTokenUrl'));
    assert.ok(bridge.includes('buildVaultCommunityChatVoiceEndUrl'));
    assert.ok(bridge.includes('buildVaultCommunityChatMentorsUrl'));
    assert.ok(bridge.includes('buildVaultCommunityChatDmChannelUrl'));
    assert.ok(origin.includes('voice-huddle-end'));
    assert.equal(bridge.includes('voice-huddle-mod'), false);
    assert.equal(origin.includes('voice-huddle-mod'), false);
    assert.ok(bridge.includes('parseVaultHuddleTokenResponse'));
    assert.equal(bridge.includes('LIVEKIT_API_SECRET'), false);
  });

  it('wires New chat, Start huddle, Join, and End on UI', () => {
    const list = readFileSync(join(root, 'pages/CommunityChat.tsx'), 'utf8');
    const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    const overlay = readFileSync(
      join(root, 'components/community/ConnectVoiceHuddle.tsx'),
      'utf8'
    );
    assert.ok(list.includes('useHuddleLive'));
    assert.ok(list.includes('HuddleLiveBadge'));
    assert.ok(list.includes('New chat') || list.includes('New'));
    assert.ok(list.includes('searchChatDirectory'));
    assert.ok(list.includes('openDirectMessage'));
    const huddleCtx = readFileSync(join(root, 'context/HuddleLiveContext.tsx'), 'utf8');
    assert.ok(huddleCtx.includes('fetchHuddleStatuses'));
    assert.ok(huddleCtx.includes('10_000'));
    const badge = readFileSync(join(root, 'components/huddle/HuddleLiveDot.tsx'), 'utf8');
    assert.ok(badge.includes('bg-emerald-500'));
    assert.equal(list.includes('bg-red-600'), false);
    assert.ok(room.includes('Join huddle'));
    assert.ok(room.includes('bg-emerald-500'));
    assert.ok(room.includes('Start huddle'));
    assert.ok(room.includes('ConnectVoiceHuddle'));
    assert.ok(overlay.includes('livekit-client'));
    assert.ok(overlay.includes('Enable sound'));
    assert.ok(overlay.includes('fetchHuddleToken'));
    assert.ok(overlay.includes('endHuddle'));
    assert.ok(overlay.includes('End huddle for everyone'));
    assert.ok(overlay.includes('Hands raised'));
    assert.ok(overlay.includes('HuddlePeoplePanel'));
    assert.ok(overlay.includes('HuddleMobileTabs'));
    assert.ok(overlay.includes('HuddleChatPanel'));
    assert.equal(overlay.includes('voice-huddle-mod'), false);
  });
});

describe('directory + dm + huddle-end parsers', () => {
  it('requires bounded directory q', () => {
    assert.equal(parseDirectoryQuery({ q: 'Jo' }).ok, true);
    assert.deepEqual(parseDirectoryQuery({ q: '@Sheevon' }), {
      ok: true,
      q: 'Sheevon',
    });
    assert.equal(parseDirectoryQuery({ q: '@' }).ok, false);
    assert.equal(parseDirectoryQuery({}).ok, false);
    assert.equal(parseDirectoryQuery({ q: '' }).ok, false);
    assert.equal(parseDirectoryQuery({ q: 'a'.repeat(50) }).ok, false);
  });

  it('filters mentors and strips role/email', () => {
    const parsed = parseVaultDirectoryResponse(
      [
        { id: USER_ID, name: 'Jane Doe', role: 'PASTOR', email: 'a@b.com', avatar_url: null },
        { id: CHANNEL_ID, name: 'John Smith', role: 'MEMBER' },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          name: 'Sheevon Example',
          role: 'MEMBER',
        },
        { id: 'bad', name: 'Nope' },
      ],
      '@Sheevon'
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.members.length, 1);
    assert.equal(parsed.members[0].name, 'Sheevon Example');

    const jane = parseVaultDirectoryResponse(
      [
        { id: USER_ID, name: 'Jane Doe', role: 'PASTOR', email: 'a@b.com', avatar_url: null },
        { id: CHANNEL_ID, name: 'John Smith', role: 'MEMBER' },
      ],
      'jan'
    );
    assert.equal(jane.ok, true);
    assert.equal(jane.members.length, 1);
    assert.equal(jane.members[0].name, 'Jane Doe');
    assert.equal('role' in jane.members[0], false);
    assert.equal('email' in jane.members[0], false);
  });

  it('maps dm open + huddle end', () => {
    assert.deepEqual(parseOpenDmCommand({ partnerId: USER_ID }), {
      ok: true,
      partnerId: USER_ID,
    });
    assert.equal(parseOpenDmCommand({ partnerId: 'x' }).ok, false);

    const dm = parseVaultDmChannelResponse(
      {
        id: CHANNEL_ID,
        name: 'DM_x',
        visibility: 'dm',
        type: 'private',
      },
      USER_ID
    );
    assert.equal(dm.ok, true);
    assert.equal(dm.channel.visibility, 'dm');
    assert.equal(dm.partnerId, USER_ID);

    assert.deepEqual(parseHuddleEndCommand({ channelId: CHANNEL_ID }), {
      ok: true,
      channelId: CHANNEL_ID,
    });
    assert.equal(parseVaultHuddleEndResponse({ ok: true, ended: true }).ok, true);
    assert.equal(parseVaultHuddleEndResponse({ ok: false }).ok, false);
  });
});

describe('Live Huddle start rule (members join, leaders/moderators start)', () => {
  it('passes Vault huddle_start_forbidden through as huddle_not_started on every start path', () => {
    const bridge = readFileSync(join(root, 'api/community-chat.js'), 'utf8');
    assert.ok(bridge.includes("body.code === 'huddle_start_forbidden'"));
    assert.ok(bridge.includes("code: 'huddle_not_started'"));
    // huddle-token, huddle-line, daily backup, and outage fallback
    const uses = bridge.split('isHuddleStartForbidden(').length - 1;
    assert.ok(uses >= 5, `expected helper + 4 call sites, got ${uses}`);
  });
  it('client shows the not-started wording instead of "no access"', () => {
    const client = readFileSync(join(root, 'lib/communityChatClient.ts'), 'utf8');
    assert.ok(client.includes("bodyCode === 'huddle_not_started'"));
    assert.ok(client.includes("hasn't started yet"));
  });
});

describe('PLCC Chat: members join, leaders/moderators start', () => {
  it('bridge exposes huddle-can-start and returns only a boolean', () => {
    const bridge = readFileSync(join(root, 'api/community-chat.js'), 'utf8');
    const origin = readFileSync(join(root, 'api/_utils/vaultOrigin.js'), 'utf8');
    assert.ok(bridge.includes("'huddle-can-start'"));
    assert.ok(bridge.includes("canStart: body?.canStart === true"));
    assert.ok(origin.includes('voice-huddle-can-start'));
  });
  it('room hides Start for members and explains the huddle has not started', () => {
    const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    assert.ok(room.includes('fetchHuddleCanStart'));
    assert.ok(room.includes('mayStart'));
    assert.ok(room.includes("hasn't started yet"));
  });
  it('Prayer Watch opens in PLCC Connect (not a missing local page)', () => {
    const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    assert.ok(room.includes('https://plcc-connect.vercel.app/intercessors'));
    assert.equal(room.includes('to="/intercessors"'), false);
  });
  it('Vault "not started" refusals show a clear message on every start path', () => {
    const bridge = readFileSync(join(root, 'api/community-chat.js'), 'utf8');
    const client = readFileSync(join(root, 'lib/communityChatClient.ts'), 'utf8');
    assert.ok(bridge.split('isHuddleStartForbidden(').length - 1 >= 5);
    assert.ok(client.includes("bodyCode === 'huddle_not_started'"));
  });
});

describe('PLCC Chat media: photos, voice notes, videos, documents', async () => {
  const s = await import('../api/_utils/communityChatSanitize.js');
  const C = '11111111-1111-4111-8111-111111111111';
  const M = '22222222-2222-4222-8222-222222222222';
  const A = '33333333-3333-4333-8333-333333333333';
  const signed = `https://abcd.supabase.co/storage/v1/object/sign/community-files/${C}/${M}/1-x.m4a?token=t`;

  it('passes attachments through with kind from the MIME type', () => {
    const msg = s.sanitizeChatMessage({
      id: M, channel_id: C, created_at: '2026-11-02T00:00:00Z', user_id: A, user_name: 'Sis A', content: '🎤 Voice message',
      attachments: [{ id: A, mime_type: 'audio/mp4', original_filename: 'voice.m4a', size_bytes: 1234, signed_url: signed, storage_path: 'secret/path' }],
    });
    assert.equal(msg.attachments.length, 1);
    assert.equal(msg.attachments[0].kind, 'audio');
    assert.equal(msg.attachments[0].url, signed);
    assert.equal('storage_path' in msg.attachments[0], false);
  });

  it('only signed private-bucket links leave the bridge', () => {
    assert.equal(s.sanitizeChatMediaUrl('https://evil.example.com/storage/v1/object/sign/community-files/x'), null);
    assert.equal(s.sanitizeChatMediaUrl('http://abcd.supabase.co/storage/v1/object/sign/community-files/x'), null);
    assert.equal(s.sanitizeChatMediaUrl('https://abcd.supabase.co/storage/v1/object/public/community-files/x'), null);
    assert.equal(s.sanitizeChatMediaUrl(signed), signed);
  });

  it('deleted messages never show media', () => {
    const msg = s.sanitizeChatMessage({
      id: M, channel_id: C, created_at: '2026-11-02T00:00:00Z', user_id: A, deleted_at: '2026-11-02T00:01:00Z',
      attachments: [{ id: A, mime_type: 'image/jpeg', signed_url: signed }],
    });
    assert.deepEqual(msg.attachments, []);
  });

  it('upload requests are validated (size, type, no extra fields)', () => {
    assert.equal(s.parseAttachmentUploadCommand({ messageId: M, filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 5000 }).ok, true);
    assert.equal(s.parseAttachmentUploadCommand({ messageId: M, filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 26 * 1024 * 1024 }).reason, 'too_large');
    assert.equal(s.parseAttachmentUploadCommand({ messageId: M, mimeType: 'image/jpeg', sizeBytes: 1, channelId: C }).ok, false);
    assert.equal(s.parseAttachmentUploadCommand({ messageId: 'nope', mimeType: 'image/jpeg', sizeBytes: 1 }).ok, false);
  });

  it('confirm must point inside the message folder', () => {
    assert.equal(s.parseAttachmentConfirmCommand({ messageId: M, storagePath: `${C}/${M}/1-x.jpg` }).ok, true);
    assert.equal(s.parseAttachmentConfirmCommand({ messageId: M, storagePath: `${C}/other/1-x.jpg` }).ok, false);
  });

  it('room renders media, attach menu and tap-to-record voice notes', () => {
    const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    const composer = readFileSync(join(root, 'components/chat/ChatMediaComposer.tsx'), 'utf8');
    const media = readFileSync(join(root, 'lib/chatMedia.ts'), 'utf8');
    const bubble = readFileSync(join(root, 'components/chat/ChatMessageBubble.tsx'), 'utf8');
    assert.ok(bubble.includes('<ChatAttachments'));
    assert.ok(room.includes('ChatAttachButton'));
    assert.ok(room.includes('VoiceRecordingBar'));
    assert.ok(composer.includes('capture="environment"'));
    assert.ok(composer.includes('MediaRecorder'));
    assert.ok(media.includes('uploadToSignedUrl'));
    // a failed upload removes the half-sent message
    assert.ok(media.includes("deleteChatMessage(message.id)"));
  });
});

describe('PLCC Chat: instant messages, typing, phone alerts, desktop', () => {
  const bridge = readFileSync(join(root, 'api/community-chat.js'), 'utf8');
  it('room-info only passes a well-formed live topic, plus Start/mute/name', () => {
    assert.ok(bridge.includes("'room-info'"));
    assert.ok(bridge.includes("'room-mute'"));
    assert.ok(bridge.includes('/^awc-chat-[a-f0-9]{16,64}$/'));
    assert.ok(bridge.includes("typeof b.muted !== 'boolean'"));
  });
  it('room listens on its live channel and refreshes on pings; typing is shared', () => {
    const live = readFileSync(join(root, 'lib/useRoomLive.ts'), 'utf8');
    const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    assert.ok(live.includes("event: 'message'"));
    assert.ok(live.includes("event: 'typing'"));
    assert.ok(live.includes('self: false'));
    assert.ok(room.includes('useRoomLive'));
    assert.ok(room.includes('live.notifyTyping()'));
    assert.ok(room.includes('LIVE_POLL_MS'), 'slow backup polling while live');
    assert.ok(room.includes('toggleMute'));
  });
  it('phone alerts subscribe to chat messages only and open the right room', () => {
    const alerts = readFileSync(join(root, 'lib/phoneAlerts.ts'), 'utf8');
    const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');
    const push = readFileSync(join(root, 'api/_utils/pushBridge.js'), 'utf8');
    assert.ok(alerts.includes("const CHAT_TOPICS: AlertTopic[] = ['chat']"));
    assert.equal(alerts.includes("'church'"), false);
    assert.ok(sw.includes('watching'), 'no alert when already looking at that chat');
    assert.ok(sw.includes('notificationclick'));
    assert.ok(push.includes("canBroadcast: _hidden"));
  });
  it('desktop shows rooms and conversation side by side; phones one at a time', () => {
    const home = readFileSync(join(root, 'pages/ChatHome.tsx'), 'utf8');
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');
    assert.ok(home.includes('(min-width: 1024px)'));
    assert.ok(home.includes('grid-cols-[380px_minmax(0,1fr)]'));
    assert.ok(app.includes('lg:max-w-[1400px]'));
  });
});

describe('PLCC Chat: replies, reactions, edit, mentions, read receipts', async () => {
  const s = await import('../api/_utils/communityChatSanitize.js');
  const C = '11111111-1111-4111-8111-111111111111';
  const M = '22222222-2222-4222-8222-222222222222';
  const U = '33333333-3333-4333-8333-333333333333';
  it('send accepts a reply and up to 20 mentioned people', () => {
    const ok = s.parseSendChatMessageCommand({ channelId: C, content: '@Ann amen', parentId: M, mentionedUserIds: [U, U] });
    assert.deepEqual(ok, { ok: true, channelId: C, content: '@Ann amen', parentId: M, mentionedUserIds: [U] });
    assert.equal(s.parseSendChatMessageCommand({ channelId: C, content: 'x', parentId: 'nope' }).ok, false);
    assert.equal(s.parseSendChatMessageCommand({ channelId: C, content: 'x', mentionedUserIds: ['bad'] }).ok, false);
    assert.equal(s.parseSendChatMessageCommand({ channelId: C, content: 'x', mentionedUserIds: Array(21).fill(U) }).ok, false);
  });
  it('reactions: only the church set, grouped per emoji in a fixed order', () => {
    const r = s.summarizeReactions([
      { user_id: U, emoji: '🙏' },
      { user_id: M, emoji: '👍' },
      { user_id: U, emoji: '👍' },
      { user_id: U, emoji: '🖕' },
      { user_id: 'x', emoji: '👍' },
    ]);
    assert.deepEqual(r, [{ emoji: '👍', userIds: [M, U] }, { emoji: '🙏', userIds: [U] }]);
    assert.equal(s.parseReactionCommand({ messageId: M, emoji: '🖕', on: true }).ok, false);
    assert.equal(s.parseReactionCommand({ messageId: M, emoji: '❤️', on: 'yes' }).ok, false);
    assert.equal(s.parseReactionCommand({ messageId: M, emoji: '❤️', on: false }).ok, true);
  });
  it('edit + edited mark', () => {
    assert.equal(s.parseEditMessageCommand({ messageId: M, content: '  fixed  ' }).content, 'fixed');
    assert.equal(s.parseEditMessageCommand({ messageId: M, content: '' }).ok, false);
    const msg = s.sanitizeChatMessage({ id: M, channel_id: C, created_at: '2026-11-02T00:00:00Z', user_id: U, content: 'x', edited_at: '2026-11-02T00:05:00Z' });
    assert.equal(msg.editedAt, '2026-11-02T00:05:00.000Z');
  });
  it('read receipts and mention names are cleaned', () => {
    const rr = s.parseVaultReadReceipts({ readers: [{ userId: U, name: 'Ann', lastReadAt: '2026-11-02T00:00:00Z' }, { userId: 'bad' }] });
    assert.equal(rr.readers.length, 1);
    const mc = s.parseVaultMentionCandidates([{ id: U, name: 'Ann Smith', role: 'MEMBER', email: 'x@y.z' }]);
    assert.deepEqual(mc.people, [{ id: U, name: 'Ann Smith', label: null }]);
  });
  it('bridge exposes the new routes and only allowlisted Vault paths', () => {
    const bridge = readFileSync(join(root, 'api/community-chat.js'), 'utf8');
    const origin = readFileSync(join(root, 'api/_utils/vaultOrigin.js'), 'utf8');
    for (const r of ["'reaction'", "'message-edit'", "'read-receipts'", "'mentions'"]) assert.ok(bridge.includes(r), r);
    for (const sub of ['reactions', 'edit-message', 'read-receipts', 'mention-candidates', 'pin', 'search', 'channel-members']) {
      assert.ok(origin.includes(`'${sub}'`), sub);
    }
    assert.ok(origin.includes("if (!CHAT_SUBS.has(sub)) throw"));
  });
});

describe('PLCC Chat room: swipe/hold actions, reply bar, reactions, ticks', () => {
  const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
  const bubble = readFileSync(join(root, 'components/chat/ChatMessageBubble.tsx'), 'utf8');
  const actions = readFileSync(join(root, 'components/chat/MessageActions.tsx'), 'utf8');
  it('swipe right to reply, press and hold (or right-click) for options', () => {
    assert.ok(bubble.includes('SWIPE_REPLY_PX'));
    assert.ok(bubble.includes('LONG_PRESS_MS'));
    assert.ok(bubble.includes('onContextMenu'));
  });
  it('reply / edit bar, @mention list, Enter-to-send on desktop only', () => {
    assert.ok(room.includes('Replying to'));
    assert.ok(room.includes('Editing your message'));
    assert.ok(room.includes('mentionIdsInText(content, mentionPicked.current)'));
    assert.ok(room.includes("(min-width: 1024px)"));
  });
  it('delete asks first; ticks show Sent / Seen', () => {
    assert.ok(actions.includes('Remove this message for everyone?'));
    assert.ok(bubble.includes('CheckCheck'));
    assert.ok(room.includes('onRead: loadReaders'));
  });
});

describe('PLCC Chat set 4: groups, announcements, pins, search', async () => {
  const s = await import('../api/_utils/communityChatSanitize.js');
  const C = '11111111-1111-4111-8111-111111111111';
  const U = '33333333-3333-4333-8333-333333333333';
  it('channels carry announceOnly (never for DMs)', () => {
    assert.equal(s.sanitizeChatChannel({ id: C, name: 'News', visibility: 'open', announce_only: true }).announceOnly, true);
    assert.equal(s.sanitizeChatChannel({ id: C, name: 'DM_x', visibility: 'dm', announce_only: true }).announceOnly, false);
  });
  it('group create: name, kind and ministry are checked', () => {
    assert.equal(s.parseGroupCreateCommand({ name: 'Choir', kind: 'private', memberIds: [U] }).ok, true);
    assert.equal(s.parseGroupCreateCommand({ name: 'C', kind: 'private' }).reason, 'name_required');
    assert.equal(s.parseGroupCreateCommand({ name: 'Choir', kind: 'leadership' }).ok, false);
    assert.equal(s.parseGroupCreateCommand({ name: 'Choir', kind: 'ministry' }).reason, 'ministry_required');
    assert.equal(s.parseGroupCreateCommand({ name: 'Choir', kind: 'open', visibility: 'dm' }).ok, false);
  });
  it('people lists never pass emails; moderators show as group admins', () => {
    const p = s.sanitizePeople({ members: [{ user_id: U, name: 'Ann', email: 'a@x.org', role: 'moderator', source: 'manual' }] });
    assert.deepEqual(p, [{ id: U, name: 'Ann', roomRole: 'admin', isCreator: false, fromMinistry: false }]);
  });
  it('search results and pins are cleaned; DM names hidden', () => {
    const r = s.sanitizeSearchResults([{ id: U, channelId: C, channelName: 'DM_abc', content: 'hi', authorName: 'Ann', createdAt: '2026-11-02T00:00:00Z' }]);
    assert.equal(r[0].channelName, null);
    assert.equal(s.sanitizePinned([{ id: 'bad' }, { id: U, content: 'Read me', authorName: 'Pastor' }]).length, 1);
  });
});

describe('PLCC Chat set 4 screens + account', () => {
  const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
  const list = readFileSync(join(root, 'pages/CommunityChat.tsx'), 'utf8');
  const account = readFileSync(join(root, 'components/chat/AccountMenu.tsx'), 'utf8');
  const app = readFileSync(join(root, 'App.tsx'), 'utf8');
  it('account menu signs out (and stops this phone’s alerts), links to Connect and the Vault', () => {
    assert.ok(account.includes('turnOffAlerts'));
    assert.ok(account.includes("navigate('/signed-out'"));
    assert.ok(account.includes('CONNECT_URL') && account.includes('VAULT_URL'));
    assert.ok(app.includes('path="/signed-out"'));
  });
  it('announcement rooms replace the message box for members', () => {
    assert.ok(room.includes('Only leaders can send messages here'));
    assert.ok(room.includes('{!canPost ? ('));
  });
  it('pins banner, room search and group info', () => {
    assert.ok(room.includes('Pinned{pins.length > 1'));
    assert.ok(room.includes('searchChatMessages(q, channelId)'));
    assert.ok(room.includes('<GroupInfoSheet'));
  });
  it('leaders get New group; everyone can search all messages', () => {
    assert.ok(list.includes('canCreateGroups ? ('));
    assert.ok(list.includes('Search all messages'));
    assert.ok(list.includes('?m=${h.id}'));
  });
});

describe('pop-ups cover the screen (not trapped in the message box)', () => {
  for (const f of [
    'components/chat/ChatMediaComposer.tsx',
    'components/chat/ChatAttachments.tsx',
    'components/chat/MessageActions.tsx',
    'components/chat/GroupInfoSheet.tsx',
    'components/chat/NewGroupSheet.tsx',
    'components/chat/AccountMenu.tsx',
  ]) {
    it(f, () => assert.ok(readFileSync(join(root, f), 'utf8').includes('<Portal>')));
  }
  it('camera choice only on phones/tablets', () => {
    const c = readFileSync(join(root, 'components/chat/ChatMediaComposer.tsx'), 'utf8');
    assert.ok(c.includes("'(pointer: coarse)'"));
  });
});

describe('direct messages belong to the signed-in account', async () => {
  const s = await import('../api/_utils/communityChatSanitize.js');
  it('dm-list is cleaned', () => {
    const C = '11111111-1111-4111-8111-111111111111';
    const U = '33333333-3333-4333-8333-333333333333';
    const r = s.sanitizeDmList({ conversations: [{ channelId: C, partnerId: U, partnerName: 'Sheevon', lastMessageAt: '2026-11-02T10:00:00Z', lastMessage: 'Hi' }, { channelId: 'x' }] });
    assert.equal(r.length, 1);
    assert.equal(r[0].partnerName, 'Sheevon');
  });
  it('list comes from the Vault; this device only keeps a per-account copy', () => {
    const list = readFileSync(join(root, 'pages/CommunityChat.tsx'), 'utf8');
    const recents = readFileSync(join(root, 'lib/dmRecents.ts'), 'utf8');
    assert.ok(list.includes('fetchDmList()'));
    assert.ok(recents.includes('awc.chat.dmRecents.v2.${ownerId}'));
    assert.ok(recents.includes('localStorage.removeItem(LEGACY_KEY)'));
  });
});

describe('@everyone, richer @ list, archive', async () => {
  const s = await import('../api/_utils/communityChatSanitize.js');
  const U = '33333333-3333-4333-8333-333333333333';
  it('@ list shows leader labels, never raw roles or emails', () => {
    const r = s.parseVaultMentionCandidates([{ id: U, name: 'Kenneth M', role: 'PASTOR', email: 'p@x.org' }, { id: '44444444-4444-4444-8444-444444444444', name: 'Ann', role: 'MEMBER' }]);
    assert.deepEqual(r.people, [{ id: U, name: 'Kenneth M', label: 'Pastor' }, { id: '44444444-4444-4444-8444-444444444444', name: 'Ann', label: null }]);
  });
  it('archives cleaned', () => {
    assert.deepEqual(s.sanitizeArchives({ archived: [{ channelId: U, archivedAt: '2026-11-02T00:00:00Z' }, { channelId: 'x' }] }).length, 1);
  });
  it('room: @everyone only for room leaders; archive button; list: Archived section + hold menu', () => {
    const room = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    const list = readFileSync(join(root, 'pages/CommunityChat.tsx'), 'utf8');
    assert.ok(room.includes("canPin && ('everyone'.startsWith(q)"));
    assert.ok(room.includes('aria-label="Archive this chat"'));
    assert.ok(list.includes('Archived ({archivedCount})'));
    assert.ok(list.includes('Unarchive chat'));
    assert.ok(list.includes('onContextMenu'));
  });
});

describe('parseReportMessageCommand', () => {
  const id = '11111111-2222-4333-8444-555555555555';

  it('accepts a known reason with an optional note', () => {
    assert.deepEqual(parseReportMessageCommand({ messageId: id, reason: 'harassment', note: '  please look  ' }), {
      ok: true,
      messageId: id,
      reason: 'harassment',
      note: 'please look',
    });
    assert.equal(parseReportMessageCommand({ messageId: id, reason: 'spam' }).note, '');
  });

  it('rejects unknown reasons, bad ids, extra fields and long notes', () => {
    assert.equal(parseReportMessageCommand({ messageId: id, reason: 'boring' }).ok, false);
    assert.equal(parseReportMessageCommand({ messageId: 'nope', reason: 'spam' }).ok, false);
    assert.equal(parseReportMessageCommand({ messageId: id, reason: 'spam', reporterId: id }).ok, false);
    assert.equal(parseReportMessageCommand({ messageId: id, reason: 'other', note: 'x'.repeat(501) }).ok, false);
    assert.equal(parseReportMessageCommand({ messageId: id, reason: 'other', note: 5 }).ok, false);
    assert.equal(parseReportMessageCommand(null).ok, false);
  });
});
