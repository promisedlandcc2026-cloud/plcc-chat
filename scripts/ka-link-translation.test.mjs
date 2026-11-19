/**
 * #13 Live translation in Ka Link (Nov 2026).
 * Run: node --test scripts/ka-link-translation.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolInstanceCount, readWakeConfig, stsBody, wakeRequest } from '../api/_utils/translationWake.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const huddle = read('components/community/ConnectVoiceHuddle.tsx');
const ui = read('components/huddle/HuddleTranslation.tsx');
const hostSwitch = read('lib/translation/hostSwitch.ts');
const protocol = read('lib/translation/protocol.ts');
const wakeApi = read('api/translation-wake.js');

describe('members see translated captions', () => {
  it('Translate button and panel are in both call layouts', () => {
    assert.equal((huddle.match(/<TranslateButton t=\{translation\}/g) || []).length, 2);
    assert.equal((huddle.match(/<TranslationPanel t=\{translation\} \/>/g) || []).length, 2);
  });
  it('accepts only server-sent translation packets on the translation topic', () => {
    assert.match(ui, /if \(!isTrustedTranslationPacket\(topic, participant\?\.identity\)\) return;/);
    assert.match(protocol, /export const TRANSLATION_TOPIC = 'plcc\.translate\.v1'/);
    assert.match(protocol, /return !senderIdentity;|senderIdentity == null|!senderIdentity/);
  });
  it('a member never publishes anything for translation', () => {
    assert.doesNotMatch(ui, /publishData/);
  });
  it('remembers the caption language on the device', () => {
    assert.match(ui, /plcc_ka_link_translate_lang/);
  });
});

describe('host switch', () => {
  it('only the huddle host or a co-host gets the switch', () => {
    assert.match(ui, /isHuddleHostOrCoHost\(room\.metadata, room\.localParticipant\.identity\)/);
    assert.match(ui, /\{t\.canControl \? \(/);
  });
  it('uses the attribute the worker reads, with the preaching language', () => {
    assert.match(hostSwitch, /HOST_TRANSLATE_ATTRIBUTE = 'plcc\.translate'/);
    assert.match(hostSwitch, /\{ on: true, src \}/);
    assert.match(ui, /setAttributes\(\{ \[HOST_TRANSLATE_ATTRIBUTE\]: translateAttributeValue\(true, src\) \}\)/);
    assert.match(ui, /setAttributes\(\{ \[HOST_TRANSLATE_ATTRIBUTE\]: translateAttributeValue\(false\) \}\)/);
  });
  it('switching on wakes the translator', () => {
    assert.match(ui, /await wakeTranslator\(\)/);
  });
  it('offers English and Luganda both ways', () => {
    assert.match(hostSwitch, /code: 'en'[\s\S]*code: 'lg'/);
  });
});

describe('wake endpoint', () => {
  const env = {
    TRANSLATION_GCP_PROJECT_NUMBER: '191365220688',
    TRANSLATION_WIF_POOL: 'vercel-plcc',
    TRANSLATION_WIF_PROVIDER: 'vercel',
    TRANSLATION_WAKER_SA: 'plcc-translation-waker@gen-lang-client-0782882600.iam.gserviceaccount.com',
    TRANSLATION_WORKER_POOL: 'projects/gen-lang-client-0782882600/locations/europe-west4/workerPools/plcc-live-translation',
  };
  it('reports exactly what is missing and refuses to run unconfigured', () => {
    const r = readWakeConfig({});
    assert.equal(r.ok, false);
    assert.equal(r.missing.length, 5);
    assert.match(wakeApi, /translation_unconfigured/);
  });
  it('builds the federation audience from config', () => {
    const r = readWakeConfig(env);
    assert.equal(r.ok, true);
    assert.equal(r.cfg.audience, '//iam.googleapis.com/projects/191365220688/locations/global/workloadIdentityPools/vercel-plcc/providers/vercel');
    assert.equal(readWakeConfig({ ...env, TRANSLATION_WORKER_POOL: 'projects/x/locations/y/services/z' }).ok, false);
  });
  it('STS exchange asks for a short-lived cloud-platform token', () => {
    const b = new URLSearchParams(stsBody('aud', 'jwt'));
    assert.equal(b.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange');
    assert.equal(b.get('subject_token'), 'jwt');
  });
  it('only ever asks for 1 instance, and only when asleep', () => {
    assert.deepEqual(wakeRequest(env.TRANSLATION_WORKER_POOL).body, { scaling: { manualInstanceCount: 1 } });
    assert.equal(poolInstanceCount({}), 0);
    assert.equal(poolInstanceCount({ scaling: { manualInstanceCount: 1 } }), 1);
    assert.match(wakeApi, /poolInstanceCount\(await cur\.json\(\)\) >= 1/);
  });
  it('requires a signed-in approved member and never stores a Google key', () => {
    assert.match(wakeApi, /parseBearerAuthorization/);
    assert.match(wakeApi, /who\.kind !== 'member'/);
    assert.doesNotMatch(wakeApi, /private_key|GOOGLE_APPLICATION_CREDENTIALS/);
  });
});

describe('tidy call tools (Nov 2026)', () => {
  const toolbar = huddle.slice(huddle.indexOf('<div className="pr-tools" role="toolbar"'), huddle.indexOf('{moreOpen ? ('));
  it('bar keeps everyday tools (Bible included) + More; Prayer Request lives in the side panel', () => {
    assert.doesNotMatch(toolbar, /setSheet\('prayer'\)|End for everyone|setRecordingsOpen/);
    assert.match(toolbar, /onClick=\{openBible\}/);
    assert.match(toolbar, /data-testid="huddle-more-tools"/);
    assert.match(toolbar, /<TranslateButton/);
  });
  it('host tools are in More, only for moderators; REC stays visible while recording', () => {
    assert.match(huddle, /\{canModerate \? \([\s\S]*Host tools[\s\S]*End for everyone/);
    assert.match(toolbar, /isRecording && canModerate \?[\s\S]*huddle-recording-chip/);
  });
  it('phones get 44px targets and Prayer Request in More', () => {
    const css = read('prayer-room.css');
    assert.match(css, /\.pr-tools \.pr-tool\.is-icon \{ width: 44px; \}/);
    assert.match(huddle, /pr-more-item pr-phone-only/);
  });
});
