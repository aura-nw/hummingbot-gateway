import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { AvailableNetworks } from '../../services/config-manager-types';

export namespace PiperxswapConfig {
  export interface NetworkConfig {
    allowedSlippage: string;
    gasLimitEstimate: number;
    ttl: number;
    piperxswapRouterAddress: (chain: string, network: string) => string;
    tradingTypes: Array<string>;
    chainType: string;
    availableNetworks: Array<AvailableNetworks>;
  }

  export const config: NetworkConfig = {
    allowedSlippage: ConfigManagerV2.getInstance().get(
      'piperxswap.allowedSlippage',
    ),
    gasLimitEstimate: ConfigManagerV2.getInstance().get(
      'piperxswap.gasLimitEstimate',
    ),
    ttl: ConfigManagerV2.getInstance().get('piperxswap.ttl'),
    piperxswapRouterAddress: (chain: string, network: string) =>
      ConfigManagerV2.getInstance().get(
        'piperxswap.contractAddresses.' +
          chain +
          '.' +
          network +
          '.piperxswapRouterAddress',
      ),
    tradingTypes: ['AMM'],
    chainType: 'EVM',
    availableNetworks: [
      {
        chain: 'story',
        networks: ['testnet'],
      },
    ],
  };
}
