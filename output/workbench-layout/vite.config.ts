import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const workbenchModules = resolve(__dirname, "../../apps/workbench-web/node_modules");

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@ant-design/icons": resolve(workbenchModules, "@ant-design/icons"),
      "@ant-design/pro-components": resolve(workbenchModules, "@ant-design/pro-components"),
      antd: resolve(workbenchModules, "antd"),
      react: resolve(workbenchModules, "react"),
      "react-dom": resolve(workbenchModules, "react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
  },
});
