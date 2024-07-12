import Decimal from 'decimal.js-light';
import { BigNumber, Transaction, Wallet } from 'ethers';
import { Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import {
  HttpException,
  LOAD_WALLET_ERROR_CODE,
  LOAD_WALLET_ERROR_MESSAGE,
  TOKEN_NOT_SUPPORTED_ERROR_CODE,
  TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
  PRICE_FAILED_ERROR_CODE,
  PRICE_FAILED_ERROR_MESSAGE,
  TRADE_FAILED_ERROR_CODE,
  TRADE_FAILED_ERROR_MESSAGE,
  SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_CODE,
  SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_MESSAGE,
  SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_CODE,
  SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_MESSAGE,
  UNKNOWN_ERROR_ERROR_CODE,
  UNKNOWN_ERROR_MESSAGE,
} from '../../services/error-handler';
import { TokenInfo } from '../../chains/auraevm/auraevm-base';
import { latency, gasCostInEthString } from '../../services/base';
import {
  Auraevmish,
  ExpectedTrade,
  Halotradeevmish,
  UniswapLPish,
  Tokenish,
  Fractionish,
} from '../../services/common-interfaces';
import { logger } from '../../services/logger';
import {
  EstimateGasResponse,
  PriceRequest,
  PriceResponse,
  TradeRequest,
  TradeResponse,
  AddLiquidityRequest,
  AddLiquidityResponse,
  RemoveLiquidityRequest,
  RemoveLiquidityResponse,
  CollectEarnedFeesRequest,
  PositionRequest,
  PositionResponse,
  PoolPriceRequest,
  PoolPriceResponse,
} from '../../amm/amm.requests';

export interface TradeInfo {
  baseToken: Tokenish;
  quoteToken: Tokenish;
  requestAmount: BigNumber;
  expectedTrade: ExpectedTrade;
}

export async function txWriteData(
  auraevmish: Auraevmish,
  address: string,
  maxFeePerGas?: string,
  maxPriorityFeePerGas?: string
): Promise<{
  wallet: Wallet;
  maxFeePerGasBigNumber: BigNumber | undefined;
  maxPriorityFeePerGasBigNumber: BigNumber | undefined;
}> {
  let maxFeePerGasBigNumber: BigNumber | undefined;
  if (maxFeePerGas) {
    maxFeePerGasBigNumber = BigNumber.from(maxFeePerGas);
  }
  let maxPriorityFeePerGasBigNumber: BigNumber | undefined;
  if (maxPriorityFeePerGas) {
    maxPriorityFeePerGasBigNumber = BigNumber.from(maxPriorityFeePerGas);
  }

  let wallet: Wallet;
  try {
    wallet = await auraevmish.getWallet(address);
  } catch (err) {
    logger.error(`Wallet ${address} not available.`);
    throw new HttpException(
      500,
      LOAD_WALLET_ERROR_MESSAGE + err,
      LOAD_WALLET_ERROR_CODE
    );
  }
  return { wallet, maxFeePerGasBigNumber, maxPriorityFeePerGasBigNumber };
}

export async function getTradeInfo(
  auraevmish: Auraevmish,
  halotradeevmish: Halotradeevmish,
  baseAsset: string,
  quoteAsset: string,
  baseAmount: Decimal,
  tradeSide: string,
  allowedSlippage?: string
): Promise<TradeInfo> {
  const baseToken: Tokenish = getFullTokenFromSymbol(
    auraevmish,
    halotradeevmish,
    baseAsset
  );
  const quoteToken: Tokenish = getFullTokenFromSymbol(
    auraevmish,
    halotradeevmish,
    quoteAsset
  );
  const requestAmount: BigNumber = BigNumber.from(
    baseAmount.toFixed(baseToken.decimals).replace('.', '')
  );

  let expectedTrade: ExpectedTrade;
  if (tradeSide === 'BUY') {
    expectedTrade = await halotradeevmish.estimateBuyTrade(
      quoteToken,
      baseToken,
      requestAmount,
      allowedSlippage
    );
  } else {
    expectedTrade = await halotradeevmish.estimateSellTrade(
      baseToken,
      quoteToken,
      requestAmount,
      allowedSlippage
    );
  }

  return {
    baseToken,
    quoteToken,
    requestAmount,
    expectedTrade,
  };
}

export async function price(
  auraevmish: Auraevmish,
  halotradeevmish: Halotradeevmish,
  req: PriceRequest
): Promise<PriceResponse> {
  const startTimestamp: number = Date.now();
  let tradeInfo: TradeInfo;
  try {
    tradeInfo = await getTradeInfo(
      auraevmish,
      halotradeevmish,
      req.base,
      req.quote,
      new Decimal(req.amount),
      req.side,
      req.allowedSlippage
    );
  } catch (e) {
    if (e instanceof Error) {
      throw new HttpException(
        500,
        PRICE_FAILED_ERROR_MESSAGE + e.message,
        PRICE_FAILED_ERROR_CODE
      );
    } else {
      throw new HttpException(
        500,
        UNKNOWN_ERROR_MESSAGE,
        UNKNOWN_ERROR_ERROR_CODE
      );
    }
  }

  const trade = tradeInfo.expectedTrade.trade;
  const expectedAmount = tradeInfo.expectedTrade.expectedAmount;

  const tradePrice =
    req.side === 'BUY' ? trade.executionPrice.invert() : trade.executionPrice;

  const gasLimitTransaction = auraevmish.gasLimitTransaction;
  const gasPrice = auraevmish.gasPrice;
  const gasLimitEstimate = halotradeevmish.gasLimitEstimate;
  return {
    network: auraevmish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    base: tradeInfo.baseToken.address,
    quote: tradeInfo.quoteToken.address,
    amount: new Decimal(req.amount).toFixed(tradeInfo.baseToken.decimals),
    rawAmount: tradeInfo.requestAmount.toString(),
    expectedAmount: expectedAmount.toSignificant(8),
    price: tradePrice.toSignificant(8),
    gasPrice: gasPrice,
    gasPriceToken: auraevmish.nativeTokenSymbol,
    gasLimit: gasLimitTransaction,
    gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
  };
}

export async function trade(
  auraevmish: Auraevmish,
  halotradeevmish: Halotradeevmish,
  req: TradeRequest
): Promise<TradeResponse> {
  const startTimestamp: number = Date.now();

  const limitPrice = req.limitPrice;
  const { wallet, maxFeePerGasBigNumber, maxPriorityFeePerGasBigNumber } =
    await txWriteData(
      auraevmish,
      req.address,
      req.maxFeePerGas,
      req.maxPriorityFeePerGas
    );

  let tradeInfo: TradeInfo;
  try {
    tradeInfo = await getTradeInfo(
      auraevmish,
      halotradeevmish,
      req.base,
      req.quote,
      new Decimal(req.amount),
      req.side
    );
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Could not get trade info. ${e.message}`);
      throw new HttpException(
        500,
        TRADE_FAILED_ERROR_MESSAGE + e.message,
        TRADE_FAILED_ERROR_CODE
      );
    } else {
      logger.error('Unknown error trying to get trade info.');
      throw new HttpException(
        500,
        UNKNOWN_ERROR_MESSAGE,
        UNKNOWN_ERROR_ERROR_CODE
      );
    }
  }

  const gasPrice: number = auraevmish.gasPrice;
  const gasLimitTransaction: number = auraevmish.gasLimitTransaction;
  const gasLimitEstimate: number = halotradeevmish.gasLimitEstimate;

  if (req.side === 'BUY') {
    const price: Fractionish =
      tradeInfo.expectedTrade.trade.executionPrice.invert();
    if (
      limitPrice &&
      new Decimal(price.toFixed(8)).gt(new Decimal(limitPrice))
    ) {
      logger.error('Swap price exceeded limit price.');
      throw new HttpException(
        500,
        SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_MESSAGE(
          price.toFixed(8),
          limitPrice
        ),
        SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_CODE
      );
    }

    const tx = await halotradeevmish.executeTrade(
      wallet,
      tradeInfo.expectedTrade.trade,
      gasPrice,
      halotradeevmish.router,
      halotradeevmish.ttl,
      halotradeevmish.routerAbi,
      gasLimitTransaction,
      req.nonce,
      maxFeePerGasBigNumber,
      maxPriorityFeePerGasBigNumber,
      req.allowedSlippage
    );

    if (tx.hash) {
      await auraevmish.txStorage.saveTx(
        auraevmish.chain,
        auraevmish.chainId,
        tx.hash,
        new Date(),
        auraevmish.gasPrice
      );
    }

    logger.info(
      `Trade has been executed, txHash is ${tx.hash}, nonce is ${tx.nonce}, gasPrice is ${gasPrice}.`
    );

    return {
      network: auraevmish.chain,
      timestamp: startTimestamp,
      latency: latency(startTimestamp, Date.now()),
      base: tradeInfo.baseToken.address,
      quote: tradeInfo.quoteToken.address,
      amount: new Decimal(req.amount).toFixed(tradeInfo.baseToken.decimals),
      rawAmount: tradeInfo.requestAmount.toString(),
      expectedIn: tradeInfo.expectedTrade.expectedAmount.toSignificant(8),
      price: price.toSignificant(8),
      gasPrice: gasPrice,
      gasPriceToken: auraevmish.nativeTokenSymbol,
      gasLimit: gasLimitTransaction,
      gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
      nonce: tx.nonce,
      txHash: tx.hash,
    };
  } else {
    const price: Fractionish = tradeInfo.expectedTrade.trade.executionPrice;
    logger.info(
      `Expected execution price is ${price.toFixed(6)}, ` +
        `limit price is ${limitPrice}.`
    );
    if (
      limitPrice &&
      new Decimal(price.toFixed(8)).lt(new Decimal(limitPrice))
    ) {
      logger.error('Swap price lower than limit price.');
      throw new HttpException(
        500,
        SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_MESSAGE(
          price.toFixed(8),
          limitPrice
        ),
        SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_CODE
      );
    }

    const tx = await halotradeevmish.executeTrade(
      wallet,
      tradeInfo.expectedTrade.trade,
      gasPrice,
      halotradeevmish.router,
      halotradeevmish.ttl,
      halotradeevmish.routerAbi,
      gasLimitTransaction,
      req.nonce,
      maxFeePerGasBigNumber,
      maxPriorityFeePerGasBigNumber
    );

    logger.info(
      `Trade has been executed, txHash is ${tx.hash}, nonce is ${tx.nonce}, gasPrice is ${gasPrice}.`
    );

    return {
      network: auraevmish.chain,
      timestamp: startTimestamp,
      latency: latency(startTimestamp, Date.now()),
      base: tradeInfo.baseToken.address,
      quote: tradeInfo.quoteToken.address,
      amount: new Decimal(req.amount).toFixed(tradeInfo.baseToken.decimals),
      rawAmount: tradeInfo.requestAmount.toString(),
      expectedOut: tradeInfo.expectedTrade.expectedAmount.toSignificant(8),
      price: price.toSignificant(8),
      gasPrice: gasPrice,
      gasPriceToken: auraevmish.nativeTokenSymbol,
      gasLimit: gasLimitTransaction,
      gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
      nonce: tx.nonce,
      txHash: tx.hash,
    };
  }
}

export async function addLiquidity(
  auraevmish: Auraevmish,
  halotradeevmish: UniswapLPish,
  req: AddLiquidityRequest
): Promise<AddLiquidityResponse> {
  const startTimestamp: number = Date.now();

  const { wallet, maxFeePerGasBigNumber, maxPriorityFeePerGasBigNumber } =
    await txWriteData(
      auraevmish,
      req.address,
      req.maxFeePerGas,
      req.maxPriorityFeePerGas
    );

  const fee = FeeAmount[req.fee.toUpperCase() as keyof typeof FeeAmount];

  const token0: Token = getFullTokenFromSymbol(
    auraevmish,
    halotradeevmish,
    req.token0
  ) as Token;

  const token1: Token = getFullTokenFromSymbol(
    auraevmish,
    halotradeevmish,
    req.token1
  ) as Token;

  const gasPrice: number = auraevmish.gasPrice;
  const gasLimitTransaction: number = auraevmish.gasLimitTransaction;
  const gasLimitEstimate: number = halotradeevmish.gasLimitEstimate;

  const tx = await halotradeevmish.addPosition(
    wallet,
    token0,
    token1,
    req.amount0,
    req.amount1,
    fee,
    Number(req.lowerPrice),
    Number(req.upperPrice),
    req.tokenId ? req.tokenId : 0,
    gasLimitTransaction,
    gasPrice,
    req.nonce,
    maxFeePerGasBigNumber,
    maxPriorityFeePerGasBigNumber
  );

  logger.info(
    `Liquidity added, txHash is ${tx.hash}, nonce is ${tx.nonce}, gasPrice is ${gasPrice}.`
  );

  return {
    network: auraevmish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    token0: token0.address,
    token1: token1.address,
    fee: req.fee,
    tokenId: req.tokenId ? req.tokenId : 0,
    gasPrice: gasPrice,
    gasPriceToken: auraevmish.nativeTokenSymbol,
    gasLimit: gasLimitTransaction,
    gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
    nonce: tx.nonce,
    txHash: tx.hash,
  };
}

export async function removeLiquidity(
  auraevmish: Auraevmish,
  halotradeevmish: UniswapLPish,
  req: RemoveLiquidityRequest
): Promise<RemoveLiquidityResponse> {
  const startTimestamp: number = Date.now();

  const { wallet, maxFeePerGasBigNumber, maxPriorityFeePerGasBigNumber } =
    await txWriteData(
      auraevmish,
      req.address,
      req.maxFeePerGas,
      req.maxPriorityFeePerGas
    );

  const gasPrice: number = auraevmish.gasPrice;
  const gasLimitTransaction: number = auraevmish.gasLimitTransaction;
  const gasLimitEstimate: number = halotradeevmish.gasLimitEstimate;

  const tx = await halotradeevmish.reducePosition(
    wallet,
    req.tokenId,
    req.decreasePercent ? req.decreasePercent : 100,
    gasLimitTransaction,
    gasPrice,
    req.nonce,
    maxFeePerGasBigNumber,
    maxPriorityFeePerGasBigNumber
  );

  logger.info(
    `Liquidity removed, txHash is ${tx.hash}, nonce is ${tx.nonce}, gasPrice is ${gasPrice}.`
  );

  return {
    network: auraevmish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    tokenId: req.tokenId,
    gasPrice: gasPrice,
    gasPriceToken: auraevmish.nativeTokenSymbol,
    gasLimit: gasLimitTransaction,
    gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
    nonce: tx.nonce,
    txHash: tx.hash,
  };
}

export async function collectEarnedFees(
  auraevmish: Auraevmish,
  halotradeevmish: UniswapLPish,
  req: CollectEarnedFeesRequest
): Promise<RemoveLiquidityResponse> {
  const startTimestamp: number = Date.now();

  const { wallet, maxFeePerGasBigNumber, maxPriorityFeePerGasBigNumber } =
    await txWriteData(
      auraevmish,
      req.address,
      req.maxFeePerGas,
      req.maxPriorityFeePerGas
    );

  const gasPrice: number = auraevmish.gasPrice;
  const gasLimitTransaction: number = auraevmish.gasLimitTransaction;
  const gasLimitEstimate: number = halotradeevmish.gasLimitEstimate;

  const tx: Transaction = <Transaction>(
    await halotradeevmish.collectFees(
      wallet,
      req.tokenId,
      gasLimitTransaction,
      gasPrice,
      req.nonce,
      maxFeePerGasBigNumber,
      maxPriorityFeePerGasBigNumber
    )
  );

  logger.info(
    `Fees collected, txHash is ${tx.hash}, nonce is ${tx.nonce}, gasPrice is ${gasPrice}.`
  );

  return {
    network: auraevmish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    tokenId: req.tokenId,
    gasPrice: gasPrice,
    gasPriceToken: auraevmish.nativeTokenSymbol,
    gasLimit: gasLimitTransaction,
    gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
    nonce: tx.nonce,
    txHash: tx.hash,
  };
}

export async function positionInfo(
  auraevmish: Auraevmish,
  halotradeevmish: UniswapLPish,
  req: PositionRequest
): Promise<PositionResponse> {
  const startTimestamp: number = Date.now();

  const posInfo = await halotradeevmish.getPosition(req.tokenId);

  logger.info(`Position info for position ${req.tokenId} retrieved.`);

  return {
    network: auraevmish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    ...posInfo,
  };
}

export async function poolPrice(
  auraevmish: Auraevmish,
  halotradeevmish: UniswapLPish,
  req: PoolPriceRequest
): Promise<PoolPriceResponse> {
  const startTimestamp: number = Date.now();

  const token0: Token = getFullTokenFromSymbol(
    auraevmish,
    halotradeevmish,
    req.token0
  ) as Token;

  const token1: Token = getFullTokenFromSymbol(
    auraevmish,
    halotradeevmish,
    req.token1
  ) as Token;

  const fee = FeeAmount[req.fee.toUpperCase() as keyof typeof FeeAmount];

  const prices = await halotradeevmish.poolPrice(
    token0,
    token1,
    fee,
    req.period,
    req.interval
  );

  return {
    network: auraevmish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    token0: token0.address,
    token1: token1.address,
    fee: req.fee,
    period: req.period,
    interval: req.interval,
    prices: prices,
  };
}

export function getFullTokenFromSymbol(
  auraevmish: Auraevmish,
  halotradeevmish: Halotradeevmish | UniswapLPish,
  tokenSymbol: string
): Tokenish | Token {
  const tokenInfo: TokenInfo | undefined =
    auraevmish.getTokenBySymbol(tokenSymbol);
  let fullToken: Tokenish | Token | undefined;
  if (tokenInfo) {
    fullToken = halotradeevmish.getTokenByAddress(tokenInfo.address);
  }
  if (!fullToken)
    throw new HttpException(
      500,
      TOKEN_NOT_SUPPORTED_ERROR_MESSAGE + tokenSymbol,
      TOKEN_NOT_SUPPORTED_ERROR_CODE
    );
  return fullToken;
}

export async function estimateGas(
  auraevmish: Auraevmish,
  halotradeevmish: Halotradeevmish
): Promise<EstimateGasResponse> {
  const gasPrice: number = auraevmish.gasPrice;
  const gasLimitTransaction: number = auraevmish.gasLimitTransaction;
  const gasLimitEstimate: number = halotradeevmish.gasLimitEstimate;
  return {
    network: auraevmish.chain,
    timestamp: Date.now(),
    gasPrice,
    gasPriceToken: auraevmish.nativeTokenSymbol,
    gasLimit: gasLimitTransaction,
    gasCost: gasCostInEthString(gasPrice, gasLimitEstimate),
  };
}
