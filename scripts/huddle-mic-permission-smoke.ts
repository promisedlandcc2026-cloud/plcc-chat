/** Members must be able to unmute when their token lists allowed sources as numbers (how LiveKit sends them). */
import { TrackSource } from '@livekit/protocol';
import { huddleMicrophonePublishAllowed } from '../lib/huddlePresence';

function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  OK: ${msg}`);
}
ok(huddleMicrophonePublishAllowed({ canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA] }), 'member token (numbers: mic + camera) can unmute');
ok(huddleMicrophonePublishAllowed({ canPublishSources: [] }), 'no list = everything allowed');
ok(huddleMicrophonePublishAllowed(undefined), 'no permissions yet = allowed');
ok(huddleMicrophonePublishAllowed({ canPublishSources: ['MICROPHONE'] as any }), 'names still work');
ok(!huddleMicrophonePublishAllowed({ canPublishSources: [TrackSource.CAMERA] }), 'camera-only token cannot unmute');
console.log('huddle-mic-permission-smoke: all passed');
