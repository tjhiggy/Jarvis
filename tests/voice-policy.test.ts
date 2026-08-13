import { describe, expect, it } from 'vitest';
import { shouldCreateVoiceRoom, validateVoiceRoomPolicy } from '../src/moderation/voice.js';
describe('temporary voice policy boundary', () => {
  it('allows bounded room creation decisions only', () => {
    const policy = validateVoiceRoomPolicy({ serverId: '12345678', enabled: true, maxRooms: 3, idleMinutes: 30 });
    expect(shouldCreateVoiceRoom(policy, 2)).toBe(true);
    expect(shouldCreateVoiceRoom(policy, 3)).toBe(false);
  });
  it('rejects unsafe limits', () => {
    expect(() => validateVoiceRoomPolicy({ serverId: '12345678', enabled: true, maxRooms: 0, idleMinutes: 30 })).toThrow();
  });
});
