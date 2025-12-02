import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  plugins: [react(), tailwindcss(), viteCompression()],
  build: {
    target: "es2020",
    minify: "esbuild",
    cssMinify: true,
    sourcemap: true,
    reportCompressedSize: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      treeshake: true,
      onwarn(warning, warn) {
        // Silence common non-actionable warnings to keep CI clean
        if (warning.code === "CIRCULAR_DEPENDENCY") return;
        if (warning.code === "CHUNK_SIZE_LIMIT") return;
        warn(warning);
      },
    },
  },
  server: {
    port: 4173,
  },
});
