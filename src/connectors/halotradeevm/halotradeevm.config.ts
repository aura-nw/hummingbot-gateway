import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { AvailableNetworks } from '../../services/config-manager-types';
export namespace HalotradeevmConfig {
  export interface NetworkConfig {
    allowedSlippage: string;
    gasLimitEstimate: number;
    ttl: number;
    maximumHops: number;
    halotradeevmV3SmartOrderRouterAddress: (network: string) => string;
    halotradeevmV3NftManagerAddress: (network: string) => string;
    tradingTypes: (type: string) => Array<string>;
    chainType: string;
    availableNetworks: Array<AvailableNetworks>;
    useRouter?: boolean;
    feeTier?: string;
    quoterContractAddress: (network: string) => string;
  }

  export const config: NetworkConfig = {
    allowedSlippage: ConfigManagerV2.getInstance().get(
      `halotradeevm.allowedSlippage`
    ),
    gasLimitEstimate: ConfigManagerV2.getInstance().get(
      `halotradeevm.gasLimitEstimate`
    ),
    ttl: ConfigManagerV2.getInstance().get(`halotradeevm.ttl`),
    maximumHops: ConfigManagerV2.getInstance().get(`halotradeevm.maximumHops`),
    halotradeevmV3SmartOrderRouterAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `halotradeevm.contractAddresses.${network}.halotradeevmV3SmartOrderRouterAddress`
      ),
    halotradeevmV3NftManagerAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `halotradeevm.contractAddresses.${network}.halotradeevmV3NftManagerAddress`
      ),
    tradingTypes: (type: string) => {
      return type === 'swap' ? ['AMM'] : ['AMM_LP'];
    },
    chainType: 'EVM',
    availableNetworks: [
      {
        chain: 'auraevm',
        networks: Object.keys(
          ConfigManagerV2.getInstance().get('halotradeevm.contractAddresses')
        ).filter((network) =>
          Object.keys(
            ConfigManagerV2.getInstance().get('auraevm.networks')
          ).includes(network)
        ),
      },
    ],
    useRouter: ConfigManagerV2.getInstance().get(`halotradeevm.useRouter`),
    feeTier: ConfigManagerV2.getInstance().get(`halotradeevm.feeTier`),
    quoterContractAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `halotradeevm.contractAddresses.${network}.halotradeevmV3QuoterV2ContractAddress`
      ),
  };
}
