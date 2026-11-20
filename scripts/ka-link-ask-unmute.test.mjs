/** Nov 20 2026: "Unmute their mic" asks the person (LiveKit won't switch on someone's mic). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
describe('Ask to unmute', () => {
  it('the person sees "A moderator asked you to unmute" with an Unmute button', () => {
    const h = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(h, /if \(notice\.t === 'ask-unmute'\) setUnmuteAsked\(true\);/);
    assert.match(h, /<AskUnmuteCard/);
    assert.match(h, /if \(!micEnabledRef\.current\) void toggleMic\(\);/);
    assert.match(read('components/conduct/ConductSheet.tsx'), /export const AskUnmuteCard/);
    assert.match(read('lib/memberConduct.ts'), /v\.t !== 'ask-unmute'/);
  });
  it('the moderator is told they were asked', () => {
    assert.match(read('components/community/ConnectVoiceHuddle.tsx'), /if \(action === 'unmute' && result\.asked\) setNotice\(/);
    assert.match(read('api/community-chat.js'), /asked: body\?\.unmuteRequested === true,/);
    assert.match(read('lib/communityChatClient.ts'), /asked: b\.asked === true,/);
  });
});
