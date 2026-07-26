import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import { fileURLToPath } from "node:url";
import devConfig from "./dev";
import prodConfig from "./prod";

const baseConfig: UserConfigExport = {
  projectName: "ai-crm-internal-mobile",
  date: "2026-07-26",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1 },
  sourceRoot: "src",
  outputRoot: "dist/h5",
  framework: "react",
  compiler: "webpack5",
  cache: { enable: false },
  mini: {},
  h5: {
    publicPath: "/",
    staticDirectory: "static",
    router: { mode: "browser" },
  },
};

export default defineConfig((merge, { command }) => {
  const useDevelopmentRuntime = process.env["INTERNAL_MOBILE_RUNTIME"] === "development";
  const runtimePort = fileURLToPath(new URL(useDevelopmentRuntime ? "../src/runtime.development.ts" : "../src/runtime.production.ts", import.meta.url));
  return merge({}, baseConfig, command === "build" ? prodConfig : devConfig, { alias: { "@internal-mobile/runtime-port": runtimePort } });
});
