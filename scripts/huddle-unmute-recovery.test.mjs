import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../components/community/ConnectVoiceHuddle.tsx', import.meta.url), 'utf8');

test('unmute needs a connected room and a single, confirmed microphone operation', () => {
  const toggle = source.split('const toggleMic =')[1].split('}, [channelId, conn, listenOnly, refreshTiles]);')[0];
  assert.match(toggle, /room\.state !== ConnectionState\.Connected[\s\S]*micOperation\.current === room[\s\S]*huddleMicrophonePublishAllowed[\s\S]*setMicrophoneEnabled\(next\)/);
  assert.match(toggle, /if \(roomRef\.current !== room\) return;[\s\S]*!room\.localParticipant\.isMicrophoneEnabled/);
  assert.match(toggle, /huddle_mic_enable_slow/);
});

test('manual reconnect retires the old room before starting a new attempt', () => {
  const retry = source.split('const retryConnection =')[1].split('}, [disconnectRoom]);')[0];
  assert.match(retry, /joinInFlightRef\.current[\s\S]*retiredRoomsRef\.current\.add\(room\)[\s\S]*await disconnectRoom\(\)[\s\S]*leaveIntentionalRef\.current[\s\S]*await joinRef\.current\(\)/);
  const recovered = source.split('.on(RoomEvent.Reconnected,')[1].split('.on(RoomEvent.AudioPlaybackStatusChanged')[0];
  assert.match(recovered, /isMicrophoneEnabled[\s\S]*setConn\('connected'\)/);
  assert.doesNotMatch(recovered, /setMicrophoneEnabled\(true\)/);
});
