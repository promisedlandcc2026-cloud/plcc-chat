/** Bible: Book · Chapter · Verse picker (Nov 27, 2026). Run: node --test scripts/ka-link-bible-verse.test.mjs */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../components/bible/BibleReader.tsx', import.meta.url), 'utf8');

describe('Bible verse picker', () => {
  it('has a Verse select listing this chapter\'s verses', () => {
    assert.match(src, />Verse<\/span>/);
    assert.match(src, /onChange=\{\(e\) => goToVerse\(Number\(e\.target\.value\)\)\}/);
    assert.match(src, /\{verses\.map\(\(v\) => \(\s*<option key=\{v\.n\} value=\{v\.n\}>\{v\.n\}<\/option>/);
  });
  it('jumps within this Bible only (the prayer room has its own panel)', () => {
    assert.match(src, /<li key=\{v\.n\} data-verse=\{v\.n\}>/);
    assert.match(src, /topRef\.current\?\.querySelector\(`\[data-verse="\$\{n\}"\]`\)/);
  });
});
