/**
 * "A new version is ready — Update" (Nov 20 2026): every build writes /version.json; an open
 * app that is older shows the Update banner (never reloads in the middle of a call).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Update banner', () => {
  it('each build writes version.json with an id and the plain-words notes', async () => {
    const { buildVersionPlugin } = await import('../buildVersion.mjs');
    const prev = { sha: process.env.VERCEL_GIT_COMMIT_SHA, vercel: process.env.VERCEL };
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
    const plugin = buildVersionPlugin('test-app');
    const emitted = [];
    plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
    const v = JSON.parse(emitted[0].source);
    assert.equal(emitted[0].fileName, 'version.json');
    assert.equal(v.id, 'abcdef123456');
    assert.equal(typeof v.notes, 'string');
    assert.equal(plugin.config().define.__APP_BUILD_ID__, JSON.stringify('abcdef123456'));
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL = '1';
    assert.match(JSON.parse(JSON.stringify(buildVersionPlugin('x').config().define.__APP_BUILD_ID__)), /^"b-/);
    delete process.env.VERCEL;
    assert.match(buildVersionPlugin('x').config().define.__APP_BUILD_ID__, /^"local-/);
    if (prev.sha) process.env.VERCEL_GIT_COMMIT_SHA = prev.sha;
    if (prev.vercel) process.env.VERCEL = prev.vercel;
  });

  it('whats-new.json is valid', () => {
    const j = JSON.parse(read('whats-new.json'));
    assert.equal(typeof j.notes, 'string');
    assert.ok(j.notes.length <= 280);
  });

  it('never shows on a laptop build; shows when the id differs', () => {
    const lib = read('lib/appUpdate.ts');
    assert.match(lib, /current === 'dev' \|\| current\.startsWith\('local-'\)\) return false;/);
    assert.match(lib, /return latest\.id !== current;/);
    assert.match(lib, /fetch\(`\/version\.json\?t=\$\{Date\.now\(\)\}`, \{ cache: 'no-store'/);
  });

  it('banner: Update / Later, important fixes cannot be snoozed, waits for a call to end', () => {
    const b = read('components/ui/UpdateBanner.tsx');
    assert.match(b, /data-testid="update-now"/);
    assert.match(b, /!latest\.critical \? \(/);
    assert.match(b, /if \(isCallActive\(\)\) \{\s*updateWhenCallEnds\(\);/);
    assert.match(b, /UPDATE_CHECK_MS/);
    assert.match(b, /addEventListener\('visibilitychange', onVisible\)/);
  });

  it('is mounted in the app and wired into the build', () => {
    assert.match(read('App.tsx'), /<UpdateBanner appName=/);
    assert.match(read('vite.config.ts'), /buildVersionPlugin\('/);
  });
});
