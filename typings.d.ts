import { ethers } from 'ethers';

export interface Logger {
  info: typeof console.info;
  error: typeof console.error;
  request: typeof console.info;
}

export interface SparkImpactEvaluator {
    addBalances: ethers.ContractMethod<(
        batchAddresses: string[],
        batchAmounts: bigint[]
    ) => Promise<ethers.ContractTransactionResponse>>;
}

declare module 'http-responders' {
  import type { ServerResponse } from 'http';

  export function json(res: ServerResponse, data: Record<string, any>): void;
  export function status(res: ServerResponse, code: number): void;
}
