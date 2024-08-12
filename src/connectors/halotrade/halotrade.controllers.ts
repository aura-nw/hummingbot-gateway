import {
  PriceRequest,
  PriceResponse,
  TradeRequest,
  TradeResponse,
} from '../../amm/amm.requests';
import { Aura } from '../../chains/aura/aura';
import { latency } from '../../services/base';
// import { Auraish, Halotradeish } from '../../services/common-interfaces';
import {
  HttpException,
  PRICE_FAILED_ERROR_CODE,
  PRICE_FAILED_ERROR_MESSAGE,
  UNKNOWN_ERROR_ERROR_CODE,
  UNKNOWN_ERROR_MESSAGE,
} from '../../services/error-handler';
import { Halotrade } from './halotrade';

export async function price(
  aura: Aura,
  halotrade: Halotrade,
  req: PriceRequest
): Promise<PriceResponse> {
  const startTimestamp: number = Date.now();
  let trade;
  try {
    trade = await halotrade.price(req);
    // estimateTrade = await halotrade.estimateTrade(req);
    // estimateTrade = await halotrade.trade(
    //   {
    //     address: 'aura1kku9k0652a87u8cc058z0f0wl3djk6p5l9kx5u',
    //     base: req.base,
    //     quote: req.quote,
    //     amount: req.amount,
    //     side: req.side,
    //     chain: req.chain,
    //     network: req.network,
    //   },
    //   true
    // );
    // console.log(trade?.toString());
    // console.log(estimateTrade?.toString());
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

  return {
    network: aura.chainName,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    base: req.base,
    quote: req.quote,
    amount: req.amount,
    rawAmount: req.amount,
    expectedAmount: String(trade?.expectedAmount),
    price: String(trade?.expectedPrice),
    gasPrice: aura.gasPrice,
    gasPriceToken: aura.nativeTokenSymbol,
    gasLimit: 0,
    gasCost: '0',
  };
}

export async function trade(
  halotrade: Halotrade,
  req: TradeRequest
): Promise<TradeResponse> {
  const startTimestamp: number = Date.now();
  let trade;
  try {
    // trade = await halotrade.estimateTrade(req);
    trade = await halotrade.trade(req, false);
    // console.log(trade);
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

  return {
    network: 'aura',
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    base: req.base,
    quote: req.quote,
    amount: req.amount,
    rawAmount: req.amount,
    expectedIn: String(trade?.expectedAmount),
    price: String(trade?.expectedPrice),
    gasPrice: 0,
    gasPriceToken: 'aura',
    gasLimit: 0,
    gasCost: '0',
    txHash: trade.txhash,
  };
}
