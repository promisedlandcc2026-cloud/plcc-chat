/**
 * Build stamp for the "A new version is ready — Update" banner.
 * Each build gets an id (the git commit on Vercel). The build writes /version.json with that
 * id plus the plain-words notes from whats-new.json; open copies of the app compare it with
 * the id they were built with and offer the Update button when they differ.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function buildVersionPlugin(appName) {
  const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12);
  // On Vercel without the commit id, still give each build its own id; on a laptop it is
  // "local-…", which never shows the banner.
  const id = sha || (process.env.VERCEL ? `b-${Date.now().toString(36)}` : `local-${Date.now().toString(36)}`);
  let notes = '';
  let critical = false;
  const file = resolve(process.cwd(), 'whats-new.json');
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      notes = String(j.notes || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 280);
      critical = j.critical === true;
    } catch {
      /* bad file: ship without notes */
    }
  }
  return {
    name: 'plcc-build-version',
    config: () => ({ define: { __APP_BUILD_ID__: JSON.stringify(id) } }),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ app: appName, id, builtAt: new Date().toISOString(), notes, critical }),
      });
    },
  };
}
