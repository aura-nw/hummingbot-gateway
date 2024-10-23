import { UniswapishPriceError } from '../../services/error-handler';
import { PiperxswapConfig } from './piperxswap.config';
import routerAbi from './piperxswap_router.json';
import { ContractInterface } from '@ethersproject/contracts';
import { Percent, Token, CurrencyAmount, TradeType } from '@uniswap/sdk-core';
import { Router, SwapParameters, Trade } from '@uniswap/v2-sdk';
import { Pair } from './pair.entity';
import IUniswapV2Pair from '@uniswap/v2-core/build/IUniswapV2Pair.json';
import IUniswapV2Factory from '@uniswap/v2-core/build/IUniswapV2Factory.json';
import { ExpectedTrade, Uniswapish } from '../../services/common-interfaces';
import {
  BigNumber,
  Wallet,
  Transaction,
  Contract,
  ContractTransaction,
} from 'ethers';
import { percentRegexp } from '../../services/config-manager-v2';
import { logger } from '../../services/logger';
import { getAddress, getCreate2Address } from 'ethers/lib/utils';
import { Story } from '../../chains/story/story';
import { keccak256, pack } from '@ethersproject/solidity';

export class Piperxswap implements Uniswapish {
  private static _instances: { [name: string]: Piperxswap };
  private chain: Story;
  private _router: string;
  private _routerAbi: ContractInterface;
  private _gasLimitEstimate: number;
  private _ttl: number;
  private chainId;
  private tokenList: Record<string, Token> = {};
  private _ready: boolean = false;
  private _factory: string | undefined;

  private constructor(chain: string, network: string) {
    const config = PiperxswapConfig.config;
    if (chain === 'story') {
      this.chain = Story.getInstance(network);
    } else {
      throw new Error('unsupported chain');
    }
    this.chainId = this.chain.chainId;
    this._ttl = config.ttl;
    this._routerAbi = routerAbi.abi;
    this._gasLimitEstimate = config.gasLimitEstimate;
    this._router = config.piperxswapRouterAddress(chain, network);
  }

  public static getInstance(chain: string, network: string): Piperxswap {
    if (Piperxswap._instances === undefined) {
      Piperxswap._instances = {};
    }
    if (!(chain + network in Piperxswap._instances)) {
      Piperxswap._instances[chain + network] = new Piperxswap(chain, network);
    }

    return Piperxswap._instances[chain + network];
  }

  /**
   * Given a token's address, return the connector's native representation of
   * the token.
   *
   * @param address Token address
   */
  public getTokenByAddress(address: string): Token {
    return this.tokenList[getAddress(address)];
  }

  public async init() {
    if (!this.chain.ready()) {
      await this.chain.init();
    }
    for (const token of this.chain.storedTokenList) {
      this.tokenList[token.address] = new Token(
        this.chainId,
        token.address,
        token.decimals,
        token.symbol,
        token.name,
      );
    }
    this._ready = true;
  }

  public ready(): boolean {
    return this._ready;
  }

  /**
   * Router address.
   */
  public get router(): string {
    return this._router;
  }

  /**
   * Router smart contract ABI.
   */
  public get routerAbi(): ContractInterface {
    return this._routerAbi;
  }

  /**
   * Default gas limit for swap transactions.
   */
  public get gasLimitEstimate(): number {
    return this._gasLimitEstimate;
  }

  /**
   * Default time-to-live for swap transactions, in seconds.
   */
  public get ttl(): number {
    return this._ttl;
  }

  /**
   * Gets the allowed slippage percent from configuration.
   */
  getSlippagePercentage(): Percent {
    const allowedSlippage = PiperxswapConfig.config.allowedSlippage;
    const nd = allowedSlippage.match(percentRegexp);
    if (nd) return new Percent(nd[1], nd[2]);
    throw new Error(
      'Encountered a malformed percent string in the config for ALLOWED_SLIPPAGE.',
    );
  }

  /**
   * Fetches information about a pair and constructs a pair from the given two tokens.
   * This is to replace the Fetcher Class
   * @param baseToken  first token
   * @param quoteToken second token
   */

  async fetchData(baseToken: Token, quoteToken: Token): Promise<any> {
    // const pairAddress = await this.getAddress(baseToken, quoteToken);
    // console.log(pairAddress);
    const factoryAddress = await this.getFactoryContract();
    // '0x02F75bdBb4732cc6419aC15EeBeE6BCee66e826f',
    const pairContract = new Contract(
      factoryAddress,
      IUniswapV2Factory.abi,
      this.chain.provider,
    );
    let tokenA, tokenB;
    if (baseToken.sortsBefore(quoteToken)) {
      tokenA = baseToken;
      tokenB = quoteToken;
    } else {
      tokenA = quoteToken;
      tokenB = baseToken;
    }

    const pairAddress = await pairContract.getPair(
      tokenA.address,
      tokenB.address,
    );
    const contract = new Contract(
      pairAddress,
      IUniswapV2Pair.abi,
      this.chain.provider,
    );
    const [reserves0, reserves1] = await contract.getReserves();
    const balances = [reserves0, reserves1];
    // const pair = new Pair(
    //   CurrencyAmount.fromRawAmount(baseToken, balances[0]),
    //   CurrencyAmount.fromRawAmount(quoteToken, balances[1]),
    // );
    // return pair;
    const liquidityToken = new Token(
      this.chainId,
      pairAddress,
      18,
      'UNI-V2',
      'Uniswap V2',
    );
    CurrencyAmount;
    const pair = new Pair(
      CurrencyAmount.fromRawAmount(tokenA, balances[0]),
      CurrencyAmount.fromRawAmount(tokenB, balances[1]),
      liquidityToken,
    );
    return pair;
    // const result = {
    //   chainId: this.chainId,
    //   liquidityToken,
    //   // tokens: [
    //   //   CurrencyAmount.fromRawAmount(tokenA, balances[0]),
    //   //   CurrencyAmount.fromRawAmount(tokenB, balances[1]),
    //   // ],
    //   token0: CurrencyAmount.fromRawAmount(tokenA, balances[0]).currency,
    //   token1: CurrencyAmount.fromRawAmount(tokenA, balances[1]).currency,
    //   reserve0: CurrencyAmount.fromRawAmount(tokenA, balances[0]),
    //   reserve1: CurrencyAmount.fromRawAmount(tokenB, balances[1]),
    // };
    // return result;
  }

  /**
   * Given the amount of `baseToken` to put into a transaction, calculate the
   * amount of `quoteToken` that can be expected from the transaction.
   *
   * This is typically used for calculating token sell prices.
   *
   * @param baseToken Token input for the transaction
   * @param quoteToken Output from the transaction
   * @param amount Amount of `baseToken` to put into the transaction
   */

  async estimateSellTrade(
    baseToken: Token,
    quoteToken: Token,
    amount: BigNumber,
  ): Promise<ExpectedTrade> {
    const nativeTokenAmount: CurrencyAmount<Token> =
      CurrencyAmount.fromRawAmount(baseToken, amount.toString());

    logger.info(
      `Fetching pair data for ${baseToken.address}-${quoteToken.address}.`,
    );

    const pair: Pair = await this.fetchData(baseToken, quoteToken);

    const trades: Trade<Token, Token, TradeType.EXACT_INPUT>[] =
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      Trade.bestTradeExactIn([pair], nativeTokenAmount, quoteToken, {
        maxHops: 1,
      });
    if (!trades || trades.length === 0) {
      throw new UniswapishPriceError(
        `priceSwapIn: no trade pair found for ${baseToken} to ${quoteToken}.`,
      );
    }
    logger.info(
      `Best trade for ${baseToken.address}-${quoteToken.address}: ` +
        `${trades[0].executionPrice.toFixed(6)}` +
        `${baseToken.name}.`,
    );
    const expectedAmount = trades[0].minimumAmountOut(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.getSlippagePercentage(),
    );

    return { trade: trades[0], expectedAmount };
  }
  async estimateBuyTrade(
    quoteToken: Token,
    baseToken: Token,
    amount: BigNumber,
  ): Promise<ExpectedTrade> {
    const nativeTokenAmount: CurrencyAmount<Token> =
      CurrencyAmount.fromRawAmount(baseToken, amount.toString());

    const pair: Pair = await this.fetchData(quoteToken, baseToken);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const trades: Trade<Token, Token, TradeType.EXACT_OUTPUT>[] =
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      Trade.bestTradeExactOut([pair], quoteToken, nativeTokenAmount, {
        maxHops: 1,
      });
    if (!trades || trades.length === 0) {
      throw new UniswapishPriceError(
        `priceSwapOut: no trade pair found for ${quoteToken.address} to ${baseToken.address}.`,
      );
    }
    logger.info(
      `Best trade for ${quoteToken.address}-${baseToken.address}: ` +
        `${trades[0].executionPrice.invert().toFixed(6)} ` +
        `${baseToken.name}.`,
    );

    const expectedAmount = trades[0].maximumAmountIn(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.getSlippagePercentage(),
    );
    return { trade: trades[0], expectedAmount };
  }

  /**
   * Given a wallet and a Uniswap trade, try to execute it on blockchain.
   *
   * @param wallet Wallet
   * @param trade Expected trade
   * @param gasPrice Base gas price, for pre-EIP1559 transactions
   * @param sushswapRouter Router smart contract address
   * @param ttl How long the swap is valid before expiry, in seconds
   * @param abi Router contract ABI
   * @param gasLimit Gas limit
   * @param nonce (Optional) EVM transaction nonce
   * @param maxFeePerGas (Optional) Maximum total fee per gas you want to pay
   * @param maxPriorityFeePerGas (Optional) Maximum tip per gas you want to pay
   */

  async executeTrade(
    wallet: Wallet,
    trade: Trade<Token, Token, TradeType.EXACT_INPUT | TradeType.EXACT_OUTPUT>,
    gasPrice: number,
    sushswapRouter: string,
    ttl: number,
    abi: ContractInterface,
    gasLimit: number,
    nonce?: number,
    maxFeePerGas?: BigNumber,
    maxPriorityFeePerGas?: BigNumber,
  ): Promise<Transaction> {
    const result: SwapParameters = Router.swapCallParameters(trade, {
      ttl,
      recipient: wallet.address,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      allowedSlippage: this.getSlippagePercentage(),
    });
    const contract: Contract = new Contract(sushswapRouter, abi, wallet);
    return this.chain.nonceManager.provideNonce(
      nonce,
      wallet.address,
      async (nextNonce) => {
        let tx: ContractTransaction;
        if (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined) {
          tx = await contract[result.methodName](...result.args, {
            gasLimit: gasLimit.toFixed(0),
            value: result.value,
            nonce: nextNonce,
            maxFeePerGas,
            maxPriorityFeePerGas,
          });
        } else {
          tx = await contract[result.methodName](...result.args, {
            gasPrice: (gasPrice * 1e9).toFixed(0),
            gasLimit: gasLimit.toFixed(0),
            value: result.value,
            nonce: nextNonce,
          });
        }

        logger.info(JSON.stringify(tx));
        return tx;
      },
    );
  }

  async getAddress(tokenA: Token, tokenB: Token): Promise<string> {
    return this.computePairAddress(
      '0x02F75bdBb4732cc6419aC15EeBeE6BCee66e826f',
      tokenA,
      tokenB,
    );
  }

  async computePairAddress(
    factoryAddress: string,
    tokenA: Token,
    tokenB: Token,
  ) {
    const [token0, token1] = tokenA.sortsBefore(tokenB)
      ? [tokenA, tokenB]
      : [tokenB, tokenA]; // does safety checks
    return getCreate2Address(
      factoryAddress,
      keccak256(
        ['bytes'],
        [pack(['address', 'address'], [token0.address, token1.address])],
      ),
      '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
    );
  }

  async getFactoryContract(): Promise<string> {
    if (!this._factory) {
      const routerContract = new Contract(
        this._router,
        this._routerAbi,
        this.chain.provider,
      );
      this._factory = await routerContract.factory();
    }
    if (!this._factory) {
      throw Error('Factory not found');
    }
    return this._factory;
  }
}
