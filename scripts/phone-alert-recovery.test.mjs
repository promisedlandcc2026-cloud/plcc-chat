import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup(permission = 'default', subscribed = false) {
  const events = [];
  const registration = { pushManager: { getSubscription: async () => subscribed ? { endpoint: 'https://push.test/device', toJSON: () => ({}) } : null } };
  const notification = { permission, requestPermission: () => { events.push('permission'); return Promise.resolve('denied'); } };
  const window = { PushManager: function () {}, Notification: notification, dispatchEvent() {} };
  const navigator = { serviceWorker: { getRegistration: async () => registration }, userAgent: 'Android' };
  const code = ts.transpileModule(readFileSync('lib/phoneAlerts.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, window, navigator, Notification: notification, CustomEvent: class {}, console, encodeURIComponent, require: (name) => name.includes('authAccessToken') ? { getValidAccessToken: async () => 'token' } : { detectInstallPlatform: () => 'android', isRunningInstalled: () => false }, fetch: async () => { events.push('fetch'); return { ok: true, json: async () => ({ enabled: true, subscribed: true, publicKey: 'key' }) }; } });
  return { alerts: exports, events };
}

test('permission prompt starts immediately on a user action', async () => {
  const { alerts, events } = setup();
  const result = alerts.turnOnAlerts();
  assert.deepEqual(events, ['permission']);
  assert.equal((await result).kind, 'blocked');
  assert.deepEqual(events, ['permission']);
});

test('reports blocked on this device without claiming alerts are on', async () => {
  const { alerts } = setup('denied', true);
  assert.equal((await alerts.getAlertsState()).kind, 'blocked');
});

test('does not report a saved subscription as on before permission is granted', async () => {
  const { alerts } = setup('default', true);
  assert.equal((await alerts.getAlertsState()).kind, 'off');
});
