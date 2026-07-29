import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import { fileURLToPath } from "node:url";
import devConfig from "./dev";
import prodConfig from "./prod";

const target = process.env["TARO_ENV"] === "weapp" ? "weapp" : "h5";
const baseConfig: UserConfigExport = {
  projectName: "ai-crm-external-portal",
  date: "2026-07-26",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1 },
  sourceRoot: "src",
  outputRoot: `dist/${target}`,
  framework: "react",
  compiler: "webpack5",
  cache: { enable: false },
  mini: {},
  h5: { publicPath: "/", staticDirectory: "static", router: { mode: "browser" } },
};

export default defineConfig((merge) => {
  const useDevelopmentRuntime = process.env["EXTERNAL_PORTAL_RUNTIME"] === "development";
  const runtimePort = fileURLToPath(new URL(useDevelopmentRuntime ? "../src/runtime.development.ts" : "../src/runtime.production.ts", import.meta.url));
  const externalClient = fileURLToPath(new URL("../../../packages/api-client/src/external.ts", import.meta.url));
  return merge({}, baseConfig, useDevelopmentRuntime ? devConfig : prodConfig, { alias: { "@ai-crm/api-client/external": externalClient, "@external-portal/runtime-port": runtimePort } });
});
