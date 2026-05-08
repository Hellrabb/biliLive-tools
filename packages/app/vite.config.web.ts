import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

import { version } from "./package.json";

process.env.VITE_VERSION = version;

const backendProxy = {
  target: "http://127.0.0.1:18010",
  changeOrigin: true,
};

const backendRoutes = [
  "/common",
  "/recorder",
  "/config",
  "/bili",
  "/task",
  "/video",
  "/webhook",
  "/llm",
  "/user",
  "/preset",
  "/recordHistory",
  "/files",
  "/danma",
  "/sync",
  "/ai",
  "/auto-clip",
  "/sse",
  "/assets",
];

export default defineConfig({
  define: {
    __VITE_PROXY_MODE__: "true",
  },
  root: resolve("src/renderer"),
  server: {
    host: "0.0.0.0",
    port: 28080,
    proxy: Object.fromEntries(
      backendRoutes.map((route) => [route, backendProxy]),
    ),
  },
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@types": resolve("src/types"),
    },
  },
  plugins: [
    vue({
      script: {
        defineModel: true,
      },
    }),
    AutoImport({
      imports: [
        "vue",
        {
          "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"],
        },
        "pinia",
        {
          "@renderer/hooks/useNotice": ["useNotice"],
        },
      ],
    }),
    Components({
      resolvers: [NaiveUiResolver()],
    }),
  ],
});
