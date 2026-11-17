/** Money movement input shared by ledger implementations. Amounts are integer piasters. */
export interface TransferInput {
  from: string;
  to: string;
  amount: number;
  idemKey: string;
  kind: string;
  memo?: string;
  /** ISO 4217 code. The ledger also verifies it against both account records. */
  currency?: string;
}
