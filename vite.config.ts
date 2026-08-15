import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 4173,
    strictPort: true,
  },
});
