/**
 * Phase 4 Ka Link (Nov 2026): #4 shorter sign-in, #15 phone number first,
 * #17 sign-in problem reports, #9 people beside the room on phones.
 * Run: node --test scripts/ka-link-phase4.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPhoneCountry, normalisePhone, toE164WithCountry } from '../lib/phoneCountry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const UG = findPhoneCountry('UG');

describe('phone numbers (#15)', () => {
  it('Ugandan local numbers become +256 (the old code made them +1)', () => {
    assert.equal(toE164WithCountry('0772 557842', UG), '+256772557842');
    assert.equal(toE164WithCountry('772557842', UG), '+256772557842');
    assert.equal(toE164WithCountry('256772557842', UG), '+256772557842');
    assert.equal(normalisePhone('0772557842'), '+256772557842');
    assert.equal(normalisePhone('0772 557 842'), '+256772557842');
  });
  it('members abroad', () => {
    assert.equal(toE164WithCountry('07700 900123', findPhoneCountry('GB')), '+447700900123');
    assert.equal(toE164WithCountry('(555) 123-4567', findPhoneCountry('US')), '+15551234567');
    assert.equal(toE164WithCountry('+254 712 345678', UG), '+254712345678');
    assert.equal(toE164WithCountry('00254712345678', UG), '+254712345678');
    assert.equal(normalisePhone('5551234567'), '+15551234567');
  });
  it('rejects junk', () => {
    assert.equal(toE164WithCountry('', UG), null);
    assert.equal(toE164WithCountry('123', UG), null);
    assert.equal(findPhoneCountry('ZZ').code, 'UG');
  });
});

describe('one-screen sign-in (#4)', () => {
  const page = read('pages/MemberSignIn.tsx');
  it('phone is the default, with country and password on the same screen', () => {
    assert.match(page, /const \[useEmail, setUseEmail\] = useState\(false\)/);
    assert.match(page, /data-signin-country/);
    assert.match(page, /handlePhoneFirst/);
    assert.match(page, /'Use email instead'/);
  });
});

describe('sign-in problem reports (#17)', () => {
  it('the bridge only forwards app-side reasons, never passwords', () => {
    const api = read('api/auth-phone.js');
    assert.match(api, /action === 'report-failure'/);
    assert.doesNotMatch(api, /REPORTABLE_REASONS = new Set\(\[[^\]]*wrong_password/);
    const lib = read('lib/signInFailureReport.ts');
    assert.doesNotMatch(lib, /password\s*:/i, 'never sends a password field');
  });
  it('stuck members are reported from the gate', () => {
    assert.match(read('components/auth/MemberGate.tsx'), /member_pending/);
  });
});

describe('people beside the room on phones (#9)', () => {
  it('renders a rail next to the room, hidden on computers', () => {
    assert.match(read('components/community/ConnectVoiceHuddle.tsx'), /huddle-people-rail/);
    const css = read('prayer-room.css');
    assert.match(css, /\.pr-rail \{/);
    assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*\.pr-rail \{ display: none; \}/);
  });
});
