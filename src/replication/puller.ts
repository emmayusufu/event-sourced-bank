export type PullerState = {
  observedPrimaryTip: number;
  lastPolledAt: Date | null;
  lastError: string | null;
};

let state: PullerState | null = null;

export function getPullerState(): PullerState | null {
  return state;
}

export function _setPullerStateForTesting(s: PullerState | null): void {
  state = s;
}
