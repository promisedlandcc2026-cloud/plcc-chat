/**
 * Tidy Ka Link call tools (Nov 2026).
 * Run: node --test scripts/ka-link-call-tools.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const huddle = read('components/community/ConnectVoiceHuddle.tsx');
const toolbar = huddle.slice(huddle.indexOf('<div className="pr-tools" role="toolbar"'), huddle.indexOf('{moreOpen ? ('));

describe('tidy call tools', () => {
  it('bar keeps only everyday tools + More; Bible/Prayer Request live in the side panel', () => {
    assert.doesNotMatch(toolbar, /openBible|setSheet\('prayer'\)|End for everyone|setRecordingsOpen/);
    assert.match(toolbar, /data-testid="huddle-more-tools"/);
  });
  it('host tools are in More, only for moderators; REC stays visible while recording', () => {
    assert.match(huddle, /\{canModerate \? \([\s\S]*Host tools[\s\S]*End for everyone/);
    assert.match(toolbar, /isRecording && canModerate \?[\s\S]*huddle-recording-chip/);
  });
  it('phones get 44px targets and Prayer Request in More', () => {
    assert.match(read('prayer-room.css'), /\.pr-tools \.pr-tool\.is-icon \{ width: 44px; \}/);
    assert.match(huddle, /pr-more-item pr-phone-only/);
  });
});
