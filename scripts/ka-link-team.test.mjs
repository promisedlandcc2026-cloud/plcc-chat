/**
 * Phase 3 Ka Link (Nov 2026): #18 leaders tell moderators "I'm ready".
 * (#10, #19, #20 are enforced in Canaan — see plcc scripts/community-phase-ka-link-team-smoke.ts.)
 * Run: node --test scripts/ka-link-team.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const huddle = readFileSync(join(root, 'components/community/ConnectVoiceHuddle.tsx'), 'utf8');

describe("I'm ready (#18)", () => {
  it('only team leaders see the button', () => {
    assert.match(huddle, /localTile\?\.team === 'leader'[\s\S]*huddle-ready-button/);
  });
  it('only moderators get the alert, and only from a team admin or leader', () => {
    assert.match(huddle, /topic === HUDDLE_READY_TOPIC\)[\s\S]*if \(!canModerateRef\.current \|\| !teamMayUseVideo\(participantTeam\(participant\)\)\) return;/);
  });
  it('the team role comes from the signed token attribute', () => {
    assert.match(huddle, /p\.attributes\?\.\['plcc\.team'\]/);
  });
  it('a sent alert cannot be spammed', () => {
    assert.match(huddle, /READY_RESEND_MS/);
    assert.match(huddle, /disabled=\{Boolean\(readySentAt\)\}/);
  });
});
