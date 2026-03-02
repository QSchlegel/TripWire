export const ROLLOUT_MIN_HACK_IMPROVEMENT = 0.08;
export const ROLLOUT_MAX_LEGIT_DROP = 0.02;

export function passesRolloutGate(input: { hackSuccessDelta: number; legitCompletionDrop: number }): boolean {
  return (
    input.hackSuccessDelta >= ROLLOUT_MIN_HACK_IMPROVEMENT &&
    input.legitCompletionDrop <= ROLLOUT_MAX_LEGIT_DROP
  );
}
