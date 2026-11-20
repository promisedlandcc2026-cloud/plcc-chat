/**
 * Music team (Nov 19 2026): people leaders assign upload songs they bought; Canaan decides.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMusicCommand, sanitizeMusicAnswer } from '../api/_utils/musicBridge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('Ka Link Music from the phone', () => {
  it('uploads need the "I bought it" box, an audio file and 25 MB or less', () => {
    assert.equal(parseMusicCommand({ action: 'upload-url', mime: 'audio/mpeg', size: 1000 }), null);
    assert.ok(parseMusicCommand({ action: 'upload-url', purchased: true, mime: 'audio/mpeg', size: 1000, filename: 'a.mp3' }));
    assert.equal(parseMusicCommand({ action: 'upload-url', purchased: true, mime: 'video/mp4', size: 1000 }), null);
    assert.equal(parseMusicCommand({ action: 'upload-url', purchased: true, mime: 'audio/mpeg', size: 26 * 1024 * 1024 }), null);
    assert.deepEqual(parseMusicCommand({ action: 'delete', songId: ID }), { action: 'delete', songId: ID });
    assert.deepEqual(parseMusicCommand({ action: 'list' }), { action: 'list' });
  });

  it('only Supabase signed links reach the phone', () => {
    assert.equal(sanitizeMusicAnswer('upload-url', { songId: ID, signedUrl: 'https://evil.example/x' }), null);
    const ok = sanitizeMusicAnswer('upload-url', { songId: ID, signedUrl: 'https://abc.supabase.co/storage/v1/object/upload/sign/ka-link-songs/x?token=1' });
    assert.equal(ok.songId, ID);
    const list = sanitizeMusicAnswer('list', { canManage: true, songs: [{ id: ID, title: 'Way Maker', mine: true, url: 'https://evil.example/x' }] });
    assert.equal(list.canManage, true);
    assert.equal(list.songs[0].mine, true);
    assert.equal(list.songs[0].url, null);
  });

  it('page + menu link for the music team', () => {
    assert.match(read('pages/KaLinkMusicPage.tsx'), /I bought these songs/);
    assert.match(read('pages/KaLinkMusicPage.tsx'), /disabled=\{!purchased \|\| busy\}/);
    assert.match(read('App.tsx'), /path="\/music"/);
  });
});
