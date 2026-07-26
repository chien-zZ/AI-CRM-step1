import type { UserConfigExport } from "@tarojs/cli";

const config: UserConfigExport = {
  env: { NODE_ENV: '"development"' },
  h5: { devServer: { historyApiFallback: true } },
};

export default config;
