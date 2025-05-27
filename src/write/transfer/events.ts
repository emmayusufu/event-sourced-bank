export type TransferRequested = {
  type: 'TransferRequested';
  transferId: string;
  fromId: string;
  toId: string;
  amount: number;
};
export type TransferDebited = { type: 'TransferDebited'; transferId: string };
export type TransferCredited = { type: 'TransferCredited'; transferId: string };
export type TransferCompleted = { type: 'TransferCompleted'; transferId: string };
export type TransferFailed = {
  type: 'TransferFailed';
  transferId: string;
  reason: string;
  refunded: boolean;
};

export const transferStreamId = (id: string) => `transfer-${id}`;
