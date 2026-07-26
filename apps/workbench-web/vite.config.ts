import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function vendorChunk(id: string): string | undefined {
  const path = id.replaceAll("\\", "/");
  if (!path.includes("/node_modules/")) return undefined;
  if (/\/(?:react|react-dom|react-is|react-router|react-router-dom|scheduler)\//u.test(path)) return "vendor-react";
  if (path.includes("/@tanstack/")) return "vendor-query";
  if (path.includes("/@ant-design/pro-components")) return "vendor-pro-layout";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
        onlyExplicitManualChunks: true,
      },
    },
  },
});
