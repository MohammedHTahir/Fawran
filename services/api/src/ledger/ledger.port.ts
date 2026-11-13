import { TransferInput } from './ledger.types';

/** Application-facing contract for money movement. Amounts are integer piasters. */
export const LEDGER_PORT = 'LEDGER_PORT';

export interface LedgerPort {
  createAccount(ownerId: string | null, kind?: string): Promise<string>;
  balance(accountId: string): Promise<number>;
  transfer(input: TransferInput): Promise<{ txnId: string; replayed: boolean }>;
  history(accountId: string, limit?: number): Promise<Array<{
    id: string;
    kind: string;
    memo: string | null;
    createdAt: Date | string;
    amount: number;
  }>>;
}
