import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerseMessage, parseVerseMessage, passageFromParams, passageUrl } from '../lib/verseShare.ts';

const verse = {
  ref: 'John 1:10–11',
  translation: 'KJV',
  text: 'He was in the world, and the world was made by him, and the world knew him not.',
  url: 'https://sanctum-live-nine.vercel.app/bible?t=eng_kjv&b=JHN&c=1&v=10-11',
};

describe('verse share', () => {
  it('reads a passage from share params', () => {
    const p = passageFromParams(new URLSearchParams('kind=verse&t=eng_kjv&b=jhn&c=1&v=10-11'));
    assert.deepEqual(p, { t: 'eng_kjv', b: 'JHN', c: 1, from: 10, to: 11 });
    assert.equal(passageUrl(p), verse.url);
  });

  it('rejects incomplete or unsafe params', () => {
    assert.equal(passageFromParams(new URLSearchParams('t=<x>&b=JHN&c=1')), null);
    assert.equal(passageFromParams(new URLSearchParams('t=eng_kjv&b=JOHN&c=1')), null);
    assert.equal(passageFromParams(new URLSearchParams('t=eng_kjv&b=JHN&c=0')), null);
  });

  it('round-trips a message with and without a personal note', () => {
    assert.deepEqual(parseVerseMessage(buildVerseMessage('', verse)), { ...verse, note: '' });
    const withNote = buildVerseMessage('Praying for you this week 🙏', verse);
    assert.deepEqual(parseVerseMessage(withNote), { ...verse, note: 'Praying for you this week 🙏' });
  });

  it('ignores lookalikes that do not link to the church Bible', () => {
    const fake = buildVerseMessage('', { ...verse, url: 'https://evil.example/bible?b=JHN&c=1' });
    assert.equal(parseVerseMessage(fake), null);
    assert.equal(parseVerseMessage('📖 just an emoji in a normal message'), null);
    assert.equal(parseVerseMessage('hello'), null);
  });
});
