import type { UserConfigExport } from "@tarojs/cli";

const config: UserConfigExport = {
  env: { NODE_ENV: '"production"' },
  mini: { minifyXML: {}, optimizeMainPackage: { enable: true } },
  h5: { esnextModules: ["@nutui/nutui-react-taro"] },
};
export default config;
