export interface VoiceRoomPolicy {
  readonly serverId: string;
  readonly enabled: boolean;
  readonly maxRooms: number;
  readonly idleMinutes: number;
}
const id = /^[0-9]{8,20}$/;
export function validateVoiceRoomPolicy(
  policy: VoiceRoomPolicy,
): VoiceRoomPolicy {
  if (!id.test(policy.serverId))
    throw new Error('invalid voice policy server id');
  if (
    !Number.isInteger(policy.maxRooms) ||
    policy.maxRooms < 1 ||
    policy.maxRooms > 50
  )
    throw new Error('invalid voice room limit');
  if (
    !Number.isInteger(policy.idleMinutes) ||
    policy.idleMinutes < 5 ||
    policy.idleMinutes > 1440
  )
    throw new Error('invalid voice idle limit');
  return Object.freeze({ ...policy });
}
export function shouldCreateVoiceRoom(
  policy: VoiceRoomPolicy,
  activeRooms: number,
): boolean {
  return (
    policy.enabled &&
    Number.isInteger(activeRooms) &&
    activeRooms >= 0 &&
    activeRooms < policy.maxRooms
  );
}
