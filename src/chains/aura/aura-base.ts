import axios from 'axios';
import { promises as fs } from 'fs';
import { TokenListType, TokenValue, walletPath } from '../../services/base';
import NodeCache from 'node-cache';
import fse from 'fs-extra';
import { ConfigManagerCertPassphrase } from '../../services/config-manager-cert-passphrase';
import { BigNumber } from 'ethers';

// import { Tokenish } from '../../services/common-interfaces';
import { AuraPool, AuraToken } from './aura-token';
// import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
// import { StargateClient } from '@cosmjs/stargate';
//Cosmos
// const { SigningCosmWasmClient } = require('@cosmjs/cosmwasm-stargate');
// const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
// const { StargateClient } = require('@cosmjs/stargate');
import { SigningCosmWasmClient } from 'cosmjs-cosmwasm-stargate-0.32';
import {
  StargateClient,
  IndexedTx,
  // setupIbcExtension,
} from 'cosmjs-stargate-0.32';
import {
  DirectSecp256k1Wallet,
  AccountData,
  DirectSignResponse,
} from 'cosmjs-proto-signing-0.32';
const { toBase64, fromBase64, fromHex } = require('@cosmjs/encoding');
const crypto = require('crypto').webcrypto;
// export interface AuraToken {
//   base: string;
//   address: string;
//   name: string;
//   symbol: string;
//   decimals: number;
// }

export interface CosmosWallet {
  privkey: Uint8Array;
  pubkey: Uint8Array;
  prefix: 'string';
  getAccounts(): [AccountData];
  signDirect(): DirectSignResponse;
  // fromKey(): CosmosWallet;
}

export interface KeyAlgorithm {
  name: string;
  salt: Uint8Array;
  iterations: number;
  hash: string;
}

export interface CipherAlgorithm {
  name: string;
  iv: Uint8Array;
}
export interface EncryptedPrivateKey {
  keyAlgorithm: KeyAlgorithm;
  cipherAlgorithm: CipherAlgorithm;
  ciphertext: Uint8Array;
}

export type NewBlockHandler = (bn: number) => void;

export type NewDebugMsgHandler = (msg: any) => void;

export class AuraBase {
  private _provider;
  public _cosmwasmClient;
  // public _signingClient;
  protected tokenList: AuraToken[] = [];
  protected poolList: AuraPool[] = [];
  private _tokenMap: Record<string, AuraToken> = {};

  private _ready: boolean = false;
  private _initializing: boolean = false;
  private _initPromise: Promise<void> = Promise.resolve();

  public chainName;
  public rpcUrl;
  public gasPriceConstant;
  public tokenListSource: string;
  public tokenListType: TokenListType;
  public cache: NodeCache;

  constructor(
    chainName: string,
    rpcUrl: string,
    tokenListSource: string,
    tokenListType: TokenListType,
    gasPriceConstant: number
  ) {
    this._provider = StargateClient.connect(rpcUrl);
    this._cosmwasmClient = SigningCosmWasmClient.connect(rpcUrl);

    // this._signingClient = SigningCosmWasmClient.connectWithSigner(
    //   rpcUrl,
    //   wallet,
    //   defaultSigningClientOptions
    // );

    this.chainName = chainName;
    this.rpcUrl = rpcUrl;
    this.gasPriceConstant = gasPriceConstant;
    this.tokenListSource = tokenListSource;
    this.tokenListType = tokenListType;
    this.cache = new NodeCache({ stdTTL: 3600 }); // set default cache ttl to 1hr
  }

  ready(): boolean {
    return this._ready;
  }

  public get provider() {
    return this._provider;
  }

  async init(): Promise<void> {
    if (!this.ready() && !this._initializing) {
      this._initializing = true;
      this._initPromise = this.loadTokens(
        this.tokenListSource,
        this.tokenListType
      ).then(() => {
        this._ready = true;
        this._initializing = false;
      });
    }
    return this._initPromise;
  }

  async loadTokens(
    tokenListSource: string,
    tokenListType: TokenListType
  ): Promise<void> {
    this.tokenList = await this.getTokenList(tokenListSource, tokenListType);
    this.poolList = await this.getPoolList(tokenListSource);
    if (this.tokenList) {
      this.tokenList.forEach(
        (token: AuraToken) => (this._tokenMap[token.coinDenom] = token)
      );
    }
  }

  // returns a Tokens for a given list source and list type
  async getTokenList(
    tokenListSource: string,
    tokenListType: TokenListType
  ): Promise<AuraToken[]> {
    let tokens;
    if (tokenListType === 'URL') {
      ({ data: tokens } = await axios.get(tokenListSource));
    } else {
      const readFile = await fs.readFile(tokenListSource, 'utf8');
      ({ tokens } = JSON.parse(readFile));
    }
    return tokens;
  }

  async getPoolList(tokenListSource: string): Promise<AuraPool[]> {
    let pools: AuraPool[] = [];
    const readFile = await fs.readFile(tokenListSource, 'utf8');
    ({ pools } = JSON.parse(readFile));
    return pools;
  }

  // ethereum token lists are large. instead of reloading each time with
  // getTokenList, we can read the stored tokenList value from when the
  // object was initiated.
  public get storedTokenList(): AuraToken[] {
    return this.tokenList;
  }

  public get storedTokenPool(): AuraPool[] {
    return this.poolList;
  }

  // return the Token object for a symbol
  getTokenForSymbol(symbol: string): AuraToken | null {
    return this._tokenMap[symbol] ? this._tokenMap[symbol] : null;
  }

  async getWalletFromPrivateKey(
    privateKey: string,
    prefix: string
  ): Promise<any> {
    const wallet = await DirectSecp256k1Wallet.fromKey(
      fromHex(privateKey),
      prefix
    );
    // wallet.
    return wallet;
  }

  async getAccountsfromPrivateKey(
    privateKey: string,
    prefix: string
  ): Promise<AccountData> {
    const wallet = await this.getWalletFromPrivateKey(privateKey, prefix);

    const accounts = await wallet.getAccounts();

    return accounts[0];
  }

  // returns Wallet for an address
  // TODO: Abstract-away into base.ts
  async getWallet(address: string, prefix: string): Promise<CosmosWallet> {
    const path = `${walletPath}/${this.chainName}`;

    const encryptedPrivateKey: EncryptedPrivateKey = JSON.parse(
      await fse.readFile(`${path}/${address}.json`, 'utf8'),
      (key, value) => {
        switch (key) {
          case 'ciphertext':
          case 'salt':
          case 'iv':
            return fromBase64(value);
          default:
            return value;
        }
      }
    );

    const passphrase = ConfigManagerCertPassphrase.readPassphrase();
    if (!passphrase) {
      throw new Error('missing passphrase');
    }

    return await this.decrypt(encryptedPrivateKey, passphrase, prefix);
  }

  private static async getKeyMaterial(password: string) {
    const enc = new TextEncoder();
    return await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
  }

  private static async getKey(
    keyAlgorithm: {
      salt: Uint8Array;
      name: string;
      iterations: number;
      hash: string;
    },
    keyMaterial: CryptoKey
  ) {
    return await crypto.subtle.deriveKey(
      keyAlgorithm,
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // from Solana.ts
  async encrypt(privateKey: string, password: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await AuraBase.getKeyMaterial(password);
    const keyAlgorithm = {
      name: 'PBKDF2',
      salt: salt,
      iterations: 500000,
      hash: 'SHA-256',
    };
    const key = await AuraBase.getKey(keyAlgorithm, keyMaterial);
    const cipherAlgorithm = {
      name: 'AES-GCM',
      iv: iv,
    };
    const enc = new TextEncoder();
    const ciphertext: Uint8Array = (await crypto.subtle.encrypt(
      cipherAlgorithm,
      key,
      enc.encode(privateKey)
    )) as Uint8Array;
    return JSON.stringify(
      {
        keyAlgorithm,
        cipherAlgorithm,
        ciphertext: new Uint8Array(ciphertext),
      },
      (key, value) => {
        switch (key) {
          case 'ciphertext':
          case 'salt':
          case 'iv':
            return toBase64(Uint8Array.from(Object.values(value)));
          default:
            return value;
        }
      }
    );
  }

  async decrypt(
    encryptedPrivateKey: EncryptedPrivateKey,
    password: string,
    prefix: string
  ): Promise<CosmosWallet> {
    const keyMaterial = await AuraBase.getKeyMaterial(password);
    const key = await AuraBase.getKey(
      encryptedPrivateKey.keyAlgorithm,
      keyMaterial
    );
    const decrypted = await crypto.subtle.decrypt(
      encryptedPrivateKey.cipherAlgorithm,
      key,
      encryptedPrivateKey.ciphertext
    );
    const dec = new TextDecoder();
    dec.decode(decrypted);

    return await this.getWalletFromPrivateKey(dec.decode(decrypted), prefix);
  }

  async getDenomMetadata(provider: any, denom: string): Promise<any> {
    return await provider.queryClient.bank.denomMetadata(denom);
  }

  getTokenDecimals(token: any): number {
    return token ? token.denom_units[token.denom_units.length - 1].exponent : 6; // Last denom unit has the decimal amount we need from our list
  }

  async getBalances(wallet: CosmosWallet): Promise<Record<string, TokenValue>> {
    const balances: Record<string, TokenValue> = {};

    const provider = await this._provider;
    const cosmwasmClient = await this._cosmwasmClient;

    const accounts = await wallet.getAccounts();

    const { address } = accounts[0];

    const allTokens = await provider.getAllBalances(address);

    await Promise.all(
      this.tokenList
        .filter((token) => token.type === 'cw20')
        .map(async (token) => {
          const resultCw20Token = await cosmwasmClient.queryContractSmart(
            token.address,
            {
              balance: {
                address: address,
              },
            }
          );
          balances[token.coinDenom] = {
            decimals: token.decimals,
            value: BigNumber.from(resultCw20Token.balance),
          };
        })
    );
    await Promise.all(
      allTokens.map(async (t: { denom: string; amount: string }) => {
        const token = this.getTokenByAddress(t.denom);

        if (!token && t.denom.startsWith('ibc/')) {
          const ibcHash: string = t.denom.replace('ibc/', '');

          // Get base denom by IBC hash
          if (ibcHash) {
            console.log('this is ibc denom');
            // const { denomTrace } = await setupIbcExtension(
            //   await provider.queryClient
            // ).ibc.transfer.denomTrace(ibcHash);

            // if (denomTrace) {
            //   const { baseDenom } = denomTrace;

            //   token = this.getTokenByAddress(baseDenom);
            // }
          }
        }

        // Not all tokens are added in the registry so we use the denom if the token doesn't exist
        balances[token ? token.name : t.denom] = {
          value: BigNumber.from(parseInt(t.amount, 10)),
          decimals: token?.decimals ?? 6,
        };
      })
    );

    return balances;
  }

  // returns a cosmos tx for a txHash
  async getTransaction(id: string): Promise<IndexedTx> {
    const provider = await this._provider;
    const transaction = await provider.getTx(id);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    return transaction;
  }

  public getTokenBySymbol(tokenSymbol: string): AuraToken | undefined {
    return this.tokenList.find(
      (token: AuraToken) =>
        token.symbol.toUpperCase() === tokenSymbol.toUpperCase()
    );
  }

  public getTokenByAddress(address: string): AuraToken | undefined {
    return this.tokenList.find((token: AuraToken) => token.address === address);
  }

  async getCurrentBlockNumber(): Promise<number> {
    const provider = await this._provider;
    return await provider.getHeight();
  }
}
