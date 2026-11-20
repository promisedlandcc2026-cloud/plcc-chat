/**
 * Easy navigation + floating call window (Nov 20 2026, from Sheevon's feedback):
 *  1. A bottom bar on every main page (Chats, Messages, Live, Bible, Apps) with one-tap
 *     switching to Tribes, PLCC Canaan and all PLCC apps.
 *  2. A private call can be minimized inside Ka Link or floated over other apps (picture-in-picture).
 * Run: node --test scripts/ka-link-app-nav.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Ka Link navigation bar', () => {
  it('is on every main page and switches apps', () => {
    const nav = read('components/ui/AppNav.tsx');
    for (const label of ["label: 'Chats'", "label: 'Messages'", "label: 'Live'", "label: 'Bible'"]) assert.ok(nav.includes(label), label);
    assert.match(nav, /label: 'Tribes'/);
    assert.match(nav, /label: 'PLCC Canaan'/);
    assert.match(nav, /label: 'All PLCC apps'/);
    assert.match(read('App.tsx'), /<AppNav \/>/);
    assert.match(read('pages/ChatHome.tsx'), /<AppNav desktopChat \/>/);
  });

  it('hides inside an open conversation on phones and under full-screen calls', () => {
    const lib = read('lib/appNav.ts');
    assert.match(lib, /if \(path\.startsWith\('\/community\/chat\/'\)\) return false;/);
    const nav = read('components/ui/AppNav.tsx');
    assert.match(nav, /callCoversScreen/);
    assert.match(nav, /!callCoversScreen &&/);
  });

  it('never hangs up a call when switching apps (opens a new tab during a call)', () => {
    const nav = read('components/ui/AppNav.tsx');
    assert.match(nav, /if \(isCallActive\(\)\) \{\s*e\.preventDefault\(\);\s*window\.open\(a\.href, '_blank', 'noopener'\);/);
  });

  it('full-screen pages leave room for the bar', () => {
    assert.match(read('prayer-room.css'), /body\.has-app-nav \.pr-bible-sheet-body/);
  });
});

describe('Private call: minimize and float', () => {
  it('the call screen has clear Minimize and Float buttons, above the bar', () => {
    const screen = read('components/call/DmCallScreen.tsx');
    assert.match(screen, /data-testid="call-minimize"/);
    assert.match(screen, /data-testid="call-float"/);
    assert.match(screen, /enterCallPip\(\)/);
    assert.match(screen, /fixed inset-0 z-\[480\]/);
  });

  it('the floating window stays for the whole call, floats on leaving the app, and has call buttons', () => {
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /\['outgoing', 'connecting', 'connected', 'reconnecting'\]\.includes\(call\.phase\) \? \(\s*<Suspense fallback=\{null\}>\s*<CallPip \/>/);
    const pip = read('components/call/CallPip.tsx');
    assert.match(pip, /autopictureinpicture/);
    assert.match(pip, /set\('enterpictureinpicture'/);
    assert.match(pip, /set\('hangup', ctx\.hangUp\)/);
    assert.match(pip, /set\('togglemicrophone', ctx\.toggleMic\)/);
    assert.match(pip, /captureStream/);
  });
});
