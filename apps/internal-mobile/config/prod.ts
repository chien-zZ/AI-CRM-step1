import type { UserConfigExport } from "@tarojs/cli";

const config: UserConfigExport = {
  env: { NODE_ENV: '"production"' },
  h5: {
    webpackChain(chain) {
      chain.devtool(false);
      chain.performance.maxAssetSize(256_000).maxEntrypointSize(614_400);
    },
  },
};

export default config;
