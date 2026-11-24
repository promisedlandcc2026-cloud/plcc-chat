import assert from 'node:assert/strict';
import { test } from 'node:test';
import { huddleMicrophoneFailure } from '../lib/huddlePresence.ts';

test('separates phone permissions and device failures from a host mute', () => {
  for (const [name, reason] of [
    ['NotAllowedError', 'permission_denied'],
    ['NotFoundError', 'device_not_found'],
    ['NotReadableError', 'device_unavailable'],
    ['OtherError', 'unknown'],
  ]) {
    const failure = huddleMicrophoneFailure(new DOMException('Internal device information', name));
    assert.equal(failure.reason, reason);
    assert.doesNotMatch(failure.message, /host muted|Internal device information/);
  }
});
