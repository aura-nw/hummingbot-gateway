import ethers, {
  constants,
  Wallet,
  utils,
  BigNumber,
  Transaction,
} from 'ethers';
import { bigNumberWithDecimalToStr } from '../../services/base';
import {
  HttpException,
  LOAD_WALLET_ERROR_CODE,
  LOAD_WALLET_ERROR_MESSAGE,
  TOKEN_NOT_SUPPORTED_ERROR_CODE,
  TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
} from '../../services/error-handler';
import { tokenValueToString } from '../../services/base';
import { TokenInfo } from './auraevm-base';
import { getConnector } from '../../services/connection-manager';

import {
  CustomTransactionReceipt,
  CustomTransactionResponse,
  PollRequest,
} from './auraevm.requests';
import {
  CLOBish,
  Auraevmish,
  Halotradeevmish,
} from '../../services/common-interfaces';
import {
  NonceRequest,
  NonceResponse,
  AllowancesRequest,
  ApproveRequest,
  CancelRequest,
} from '../chain.requests';
import { BalanceRequest, TokensRequest } from '../../network/network.requests';
import { logger } from '../../services/logger';
import {
  validateAllowancesRequest,
  validateApproveRequest,
  validateBalanceRequest,
  validateCancelRequest,
  validateNonceRequest,
} from './auraevm.validators';
import { validatePollRequest, validateTokensRequest } from '../chain.routes';

// TransactionReceipt from ethers uses BigNumber which is not easy to interpret directly from JSON.
// Transform those BigNumbers to string and pass the rest of the data without changes.

const toEthereumTransactionReceipt = (
  receipt: ethers.providers.TransactionReceipt | null
): CustomTransactionReceipt | null => {
  if (receipt) {
    let effectiveGasPrice = null;
    if (receipt.effectiveGasPrice) {
      effectiveGasPrice = receipt.effectiveGasPrice.toString();
    }
    return {
      ...receipt,
      gasUsed: receipt.gasUsed.toString(),
      cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
      effectiveGasPrice,
    };
  }

  return null;
};

const toEthereumTransactionResponse = (
  response: ethers.providers.TransactionResponse | null
): CustomTransactionResponse | null => {
  if (response) {
    let gasPrice = null;
    if (response.gasPrice) {
      gasPrice = response.gasPrice.toString();
    }
    return {
      ...response,
      gasPrice,
      gasLimit: response.gasLimit.toString(),
      value: response.value.toString(),
    };
  }

  return null;
};

const toEthereumTransaction = (transaction: Transaction) => {
  let maxFeePerGas = null;
  if (transaction.maxFeePerGas) {
    maxFeePerGas = transaction.maxFeePerGas.toString();
  }
  let maxPriorityFeePerGas = null;
  if (transaction.maxPriorityFeePerGas) {
    maxPriorityFeePerGas = transaction.maxPriorityFeePerGas.toString();
  }
  let gasLimit = null;
  if (transaction.gasLimit) {
    gasLimit = transaction.gasLimit.toString();
  }
  return {
    ...transaction,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
    value: transaction.value.toString(),
  };
};

export const willTxSucceed = (
  txDuration: number,
  txDurationLimit: number,
  txGasPrice: number,
  currentGasPrice: number
) => {
  if (txDuration > txDurationLimit && currentGasPrice > txGasPrice) {
    return false;
  }
  return true;
};

export class EVMController {
  // txStatus
  // -1: not in the mempool or failed
  // 1: succeeded
  // 2: in the mempool and likely to succeed
  // 3: in the mempool and likely to fail
  // 0: in the mempool but we dont have data to guess its status
  static async poll(auraevmish: Auraevmish, req: PollRequest) {
    validatePollRequest(req);

    const currentBlock = await auraevmish.getCurrentBlockNumber();
    const txData = await auraevmish.getTransaction(req.txHash);
    let txBlock, txReceipt, txStatus;
    if (!txData) {
      // tx not found, didn't reach the mempool or it never existed
      txBlock = -1;
      txReceipt = null;
      txStatus = -1;
    } else {
      txReceipt = await auraevmish.getTransactionReceipt(req.txHash);
      if (txReceipt === null) {
        // tx is in the mempool
        txBlock = -1;
        txReceipt = null;
        txStatus = 0;

        const transactions = await auraevmish.txStorage.getTxs(
          auraevmish.chain,
          auraevmish.chainId
        );

        if (transactions[txData.hash]) {
          const data: [Date, number] = transactions[txData.hash];
          const now = new Date();
          const txDuration = Math.abs(now.getTime() - data[0].getTime());
          if (
            willTxSucceed(txDuration, 60000 * 3, data[1], auraevmish.gasPrice)
          ) {
            txStatus = 2;
          } else {
            txStatus = 3;
          }
        }
      } else {
        // tx has been processed
        txBlock = txReceipt.blockNumber;
        txStatus = typeof txReceipt.status === 'number' ? 1 : -1;

        // decode logs
        if (req.connector) {
          try {
            const connector: Halotradeevmish =
              await getConnector<Halotradeevmish>(
                req.chain,
                req.network,
                req.connector
              );

            txReceipt.logs = connector.abiDecoder?.decodeLogs(txReceipt.logs);
          } catch (e) {
            logger.error(e);
          }
        }
      }
    }

    logger.info(
      `Poll ${auraevmish.chain}, txHash ${req.txHash}, status ${txStatus}.`
    );
    return {
      currentBlock,
      txHash: req.txHash,
      txBlock,
      txStatus,
      txData: toEthereumTransactionResponse(txData),
      txReceipt: toEthereumTransactionReceipt(txReceipt),
    };
  }

  static async nonce(
    auraevm: Auraevmish,
    req: NonceRequest
  ): Promise<NonceResponse> {
    validateNonceRequest(req);
    // get the address via the public key since we generally use the public
    // key to interact with gateway and the address is not part of the user config
    const wallet = await auraevm.getWallet(req.address);
    const nonce = await auraevm.nonceManager.getNonce(wallet.address);
    return { nonce };
  }

  static async nextNonce(
    auraevm: Auraevmish,
    req: NonceRequest
  ): Promise<NonceResponse> {
    validateNonceRequest(req);
    // get the address via the public key since we generally use the public
    // key to interact with gateway and the address is not part of the user config
    const wallet = await auraevm.getWallet(req.address);
    const nonce = await auraevm.nonceManager.getNextNonce(wallet.address);
    return { nonce };
  }

  static getTokenSymbolsToTokens = (
    auraevm: Auraevmish,
    tokenSymbols: Array<string>
  ): Record<string, TokenInfo> => {
    const tokens: Record<string, TokenInfo> = {};

    for (let i = 0; i < tokenSymbols.length; i++) {
      const symbol = tokenSymbols[i];
      const token = auraevm.getTokenBySymbol(symbol);
      if (token) tokens[symbol] = token;
    }

    return tokens;
  };

  static async getTokens(connection: Auraevmish, req: TokensRequest) {
    validateTokensRequest(req);
    let tokens: TokenInfo[] = [];
    if (!req.tokenSymbols) {
      tokens = connection.storedTokenList;
    } else {
      for (const t of req.tokenSymbols as []) {
        tokens.push(connection.getTokenForSymbol(t) as TokenInfo);
      }
    }

    return { tokens };
  }

  static async allowances(auraevmish: Auraevmish, req: AllowancesRequest) {
    validateAllowancesRequest(req);
    return EVMController.allowancesWithoutValidation(auraevmish, req);
  }

  static async allowancesWithoutValidation(
    auraevmish: Auraevmish,
    req: AllowancesRequest
  ) {
    const wallet = await auraevmish.getWallet(req.address);
    const tokens = EVMController.getTokenSymbolsToTokens(
      auraevmish,
      req.tokenSymbols
    );
    const spender = auraevmish.getSpender(req.spender);

    const approvals: Record<string, string> = {};
    await Promise.all(
      Object.keys(tokens).map(async (symbol) => {
        // instantiate a contract and pass in provider for read-only access
        const contract = auraevmish.getContract(
          tokens[symbol].address,
          auraevmish.provider
        );
        approvals[symbol] = tokenValueToString(
          await auraevmish.getERC20Allowance(
            contract,
            wallet,
            spender,
            tokens[symbol].decimals
          )
        );
      })
    );

    return {
      spender: spender,
      approvals: approvals,
    };
  }

  static async balances(auraevmish: Auraevmish, req: BalanceRequest) {
    validateBalanceRequest(req);

    let wallet: Wallet;
    const connector: CLOBish | undefined = req.connector
      ? ((await getConnector(req.chain, req.network, req.connector)) as CLOBish)
      : undefined;
    const balances: Record<string, string> = {};
    let connectorBalances: { [key: string]: string } | undefined;

    if (!connector?.balances) {
      try {
        wallet = await auraevmish.getWallet(req.address);
      } catch (err) {
        throw new HttpException(
          500,
          LOAD_WALLET_ERROR_MESSAGE + err,
          LOAD_WALLET_ERROR_CODE
        );
      }

      const tokens = EVMController.getTokenSymbolsToTokens(
        auraevmish,
        req.tokenSymbols
      );
      if (req.tokenSymbols.includes(auraevmish.nativeTokenSymbol)) {
        balances[auraevmish.nativeTokenSymbol] = tokenValueToString(
          await auraevmish.getNativeBalance(wallet)
        );
      }
      await Promise.all(
        Object.keys(tokens).map(async (symbol) => {
          if (tokens[symbol] !== undefined) {
            const address = tokens[symbol].address;
            const decimals = tokens[symbol].decimals;
            // instantiate a contract and pass in provider for read-only access
            const contract = auraevmish.getContract(
              address,
              auraevmish.provider
            );
            const balance = await auraevmish.getERC20Balance(
              contract,
              wallet,
              decimals
            );
            balances[symbol] = tokenValueToString(balance);
          }
        })
      );

      if (!Object.keys(balances).length) {
        throw new HttpException(
          500,
          TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
          TOKEN_NOT_SUPPORTED_ERROR_CODE
        );
      }
    } else {
      // CLOB connector or any other connector that has the concept of separation of account has to implement a balance function
      connectorBalances = await connector.balances(req);
    }

    return {
      balances: connectorBalances || balances,
    };
  }

  static async approve(auraevmish: Auraevmish, req: ApproveRequest) {
    validateApproveRequest(req);
    return await EVMController.approveWithoutValidation(auraevmish, req);
  }

  static async approveWithoutValidation(
    auraevmish: Auraevmish,
    req: ApproveRequest
  ) {
    const {
      amount,
      nonce,
      address,
      token,
      maxFeePerGas,
      maxPriorityFeePerGas,
    } = req;

    const spender = auraevmish.getSpender(req.spender);
    let wallet: Wallet;
    try {
      wallet = await auraevmish.getWallet(address);
    } catch (err) {
      throw new HttpException(
        500,
        LOAD_WALLET_ERROR_MESSAGE + err,
        LOAD_WALLET_ERROR_CODE
      );
    }
    const fullToken = auraevmish.getTokenBySymbol(token);
    if (!fullToken) {
      throw new HttpException(
        500,
        TOKEN_NOT_SUPPORTED_ERROR_MESSAGE + token,
        TOKEN_NOT_SUPPORTED_ERROR_CODE
      );
    }
    const amountBigNumber = amount
      ? utils.parseUnits(amount, fullToken.decimals)
      : constants.MaxUint256;

    let maxFeePerGasBigNumber;
    if (maxFeePerGas) {
      maxFeePerGasBigNumber = BigNumber.from(maxFeePerGas);
    }
    let maxPriorityFeePerGasBigNumber;
    if (maxPriorityFeePerGas) {
      maxPriorityFeePerGasBigNumber = BigNumber.from(maxPriorityFeePerGas);
    }
    // instantiate a contract and pass in wallet, which act on behalf of that signer
    const contract = auraevmish.getContract(fullToken.address, wallet);

    // convert strings to BigNumber
    // call approve function
    const approval = await auraevmish.approveERC20(
      contract,
      wallet,
      spender,
      amountBigNumber,
      nonce,
      maxFeePerGasBigNumber,
      maxPriorityFeePerGasBigNumber,
      auraevmish.gasPrice
    );

    if (approval.hash) {
      await auraevmish.txStorage.saveTx(
        auraevmish.chain,
        auraevmish.chainId,
        approval.hash,
        new Date(),
        auraevmish.gasPrice
      );
    }

    return {
      tokenAddress: fullToken.address,
      spender: spender,
      amount: bigNumberWithDecimalToStr(amountBigNumber, fullToken.decimals),
      nonce: approval.nonce,
      approval: toEthereumTransaction(approval),
    };
  }

  static async cancel(auraevmish: Auraevmish, req: CancelRequest) {
    validateCancelRequest(req);
    let wallet: Wallet;
    try {
      wallet = await auraevmish.getWallet(req.address);
    } catch (err) {
      throw new HttpException(
        500,
        LOAD_WALLET_ERROR_MESSAGE + err,
        LOAD_WALLET_ERROR_CODE
      );
    }

    // call cancelTx function
    const cancelTx = await auraevmish.cancelTx(wallet, req.nonce);

    logger.info(
      `Cancelled transaction at nonce ${req.nonce}, cancel txHash ${cancelTx.hash}.`
    );

    return {
      txHash: cancelTx.hash,
    };
  }
}
