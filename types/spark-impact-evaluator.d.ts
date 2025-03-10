import { ethers } from 'ethers';

export interface SparkImpactEvaluator {
    addBalances: ethers.ContractMethod<(
        batchAddresses: string[],
        batchAmounts: bigint[]
    ) => Promise<ethers.ContractTransactionResponse>>;
}
