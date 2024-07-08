import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { AvailableNetworks } from '../../services/config-manager-types';
export namespace HalotradeEVMConfig {
  export interface NetworkConfig {
    allowedSlippage: string;
    gasLimitEstimate: number;
    ttl: number;
    maximumHops: number;
    halotradeEVMV3SmartOrderRouterAddress: (network: string) => string;
    halotradeEVMV3NftManagerAddress: (network: string) => string;
    tradingTypes: (type: string) => Array<string>;
    chainType: string;
    availableNetworks: Array<AvailableNetworks>;
    useRouter?: boolean;
    feeTier?: string;
    quoterContractAddress: (network: string) => string;
  }

  export const config: NetworkConfig = {
    allowedSlippage: ConfigManagerV2.getInstance().get(
      `halotradeEVM.allowedSlippage`
    ),
    gasLimitEstimate: ConfigManagerV2.getInstance().get(
      `halotradeEVM.gasLimitEstimate`
    ),
    ttl: ConfigManagerV2.getInstance().get(`halotradeEVM.ttl`),
    maximumHops: ConfigManagerV2.getInstance().get(`halotradeEVM.maximumHops`),
    halotradeEVMV3SmartOrderRouterAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `halotradeEVM.contractAddresses.${network}.halotradeEVMV3SmartOrderRouterAddress`
      ),
    halotradeEVMV3NftManagerAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `halotradeEVM.contractAddresses.${network}.halotradeEVMV3NftManagerAddress`
      ),
    tradingTypes: (type: string) => {
      return type === 'swap' ? ['AMM'] : ['AMM_LP'];
    },
    chainType: 'EVM',
    availableNetworks: [
      {
        chain: 'ethereum',
        networks: Object.keys(
          ConfigManagerV2.getInstance().get('halotradeEVM.contractAddresses')
        ).filter((network) =>
          Object.keys(
            ConfigManagerV2.getInstance().get('ethereum.networks')
          ).includes(network)
        ),
      },
      {
        chain: 'polygon',
        networks: Object.keys(
          ConfigManagerV2.getInstance().get('halotradeEVM.contractAddresses')
        ).filter((network) =>
          Object.keys(
            ConfigManagerV2.getInstance().get('polygon.networks')
          ).includes(network)
        ),
      },
    ],
    useRouter: ConfigManagerV2.getInstance().get(`halotradeEVM.useRouter`),
    feeTier: ConfigManagerV2.getInstance().get(`halotradeEVM.feeTier`),
    quoterContractAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `halotradeEVM.contractAddresses.${network}.halotradeEVMV3QuoterV2ContractAddress`
      ),
  };
}
