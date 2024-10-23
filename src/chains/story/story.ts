import abi from '../ethereum/ethereum.abi.json';
import { logger } from '../../services/logger';
import { Contract, Transaction, Wallet } from 'ethers';
import { EthereumBase } from '../ethereum/ethereum-base';
import { getEthereumConfig as getStoryConfig } from '../ethereum/ethereum.config';
import { Provider } from '@ethersproject/abstract-provider';
import { Ethereumish } from '../../services/common-interfaces';
import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { EVMController } from '../ethereum/evm.controllers';
import { PiperxswapConfig } from '../../connectors/piperxswap/piperxswap.config';

export class Story extends EthereumBase implements Ethereumish {
  private static _instances: { [name: string]: Story };
  private _gasPrice: number;
  private _nativeTokenSymbol: string;
  private _chain: string;
  public controller;

  private constructor(network: string) {
    const config = getStoryConfig('story', network);
    super(
      'story',
      config.network.chainID,
      config.network.nodeURL,
      config.network.tokenListSource,
      config.network.tokenListType,
      config.manualGasPrice,
      config.gasLimitTransaction,
      ConfigManagerV2.getInstance().get('server.nonceDbPath'),
      ConfigManagerV2.getInstance().get('server.transactionDbPath'),
    );
    this._chain = config.network.name;
    this._nativeTokenSymbol = config.nativeCurrencySymbol;
    this._gasPrice = config.manualGasPrice;
    this.controller = EVMController;
  }

  public static getInstance(network: string): Story {
    if (Story._instances === undefined) {
      Story._instances = {};
    }
    if (!(network in Story._instances)) {
      Story._instances[network] = new Story(network);
    }

    return Story._instances[network];
  }

  public static getConnectedInstances(): { [name: string]: Story } {
    return Story._instances;
  }

  public get gasPrice(): number {
    return this._gasPrice;
  }

  public get nativeTokenSymbol(): string {
    return this._nativeTokenSymbol;
  }

  public get chain(): string {
    return this._chain;
  }

  getContract(tokenAddress: string, signerOrProvider?: Wallet | Provider) {
    return new Contract(tokenAddress, abi.ERC20Abi, signerOrProvider);
  }

  getSpender(reqSpender: string): string {
    let spender: string;
    if (reqSpender === 'piperxswap') {
      spender = PiperxswapConfig.config.piperxswapRouterAddress(
        'story',
        this._chain,
      );
    } else {
      spender = reqSpender;
    }
    return spender;
  }

  // cancel transaction
  async cancelTx(wallet: Wallet, nonce: number): Promise<Transaction> {
    logger.info(
      'Canceling any existing transaction(s) with nonce number ' + nonce + '.',
    );
    return super.cancelTxWithGasPrice(wallet, nonce, this._gasPrice * 2);
  }
}
