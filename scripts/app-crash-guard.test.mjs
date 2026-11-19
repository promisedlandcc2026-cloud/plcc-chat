/**
 * Never a blank screen: crashes show Reload / Start fresh and are logged for the church.
 * Run: node --test scripts/app-crash-guard.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

async function loadCrashDetail() {
  const out = await build({
    stdin: { contents: "export { crashDetail } from './components/routing/AppCrashBoundary.jsx';", resolveDir: root, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
  });
  const code = out.outputFiles[0].text.replace(/^import .*$/gm, '').replace(/\bReact\.Component\b/g, 'class {}');
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

describe('app crash guard', () => {
  it('wraps the whole app and the Ka Link call screen', () => {
    const app = read('App.tsx');
    assert.match(app, /<CrashGuard>[\s\S]*<HuddleLiveProvider>[\s\S]*<ActiveKaLinkProvider>[\s\S]*<AppShell \/>[\s\S]*<\/CrashGuard>/);
    assert.match(read('context/ActiveKaLinkContext.tsx'), /<AppCrashBoundary[^>]*area="call"[^>]*onCloseCall=\{closeKaLink\}[\s\S]*<ConnectVoiceHuddle/);
  });

  it('crash screen offers Reload and Start fresh (forgets the saved Ka Link)', () => {
    const b = read('components/routing/AppCrashBoundary.jsx');
    assert.match(b, />\s*Reload\s*</);
    assert.match(b, /Start fresh/);
    assert.match(b, /removeItem\(KA_LINK_SESSION_KEY\)/);
    assert.match(b, /reloadOnceForNewVersion\(\)/);
  });

  it('reports app_crash to the church log; the API accepts it', () => {
    assert.match(read('components/routing/AppCrashBoundary.jsx'), /reason: 'app_crash'/);
    assert.match(read('lib/signInFailureReport.ts'), /'app_crash'/);
    assert.match(read('api/auth-phone.js'), /'app_crash'/);
  });

  it('crash detail is short and has no links or tokens', async () => {
    const { crashDetail } = await loadCrashDetail();
    const d = crashDetail(
      new TypeError('Cannot read properties of null (reading "name") at https://plcc-chat.vercel.app/assets/x.js token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123'),
      'app',
      '/community/chat'
    );
    assert.match(d, /^\[app\] \/community\/chat · TypeError: Cannot read properties of null/);
    assert.doesNotMatch(d, /https?:|eyJ/);
    assert.ok(d.length <= 200);
  });
});
