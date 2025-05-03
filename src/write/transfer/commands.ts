export type RequestTransferCommand = {
  type: 'RequestTransfer';
  transferId: string;
  fromId: string;
  toId: string;
  amount: number;
};
