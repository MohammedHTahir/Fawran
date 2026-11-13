/** Money movement input shared by ledger implementations. Amounts are integer piasters. */
export interface TransferInput {
  from: string;
  to: string;
  amount: number;
  idemKey: string;
  kind: string;
  memo?: string;
}
