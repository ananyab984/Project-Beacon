import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    nitro(),
    react(),
  ],
  server: {
    port: 8002,
    // Neon Auth's trusted-origins check cares which exact origin (including
    // port) a request comes from -- silently moving to 8003 when 8002 is
    // taken makes the app run from an origin Neon Auth doesn't recognize,
    // which fails in confusing, hard-to-trace ways (some calls work, others
    // don't). Fail loudly instead so a port conflict gets noticed and fixed,
    // not run against silently.
    strictPort: true,
    host: true,
  },
});
