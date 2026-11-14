import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command, mode }) => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const env = loadEnv(mode, projectRoot, "VITE_");
  if (command === "build" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error(
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building the dashboard. Only public Supabase credentials belong in VITE_* variables.",
    );
  }
  const key = env.VITE_SUPABASE_ANON_KEY ?? "";
  let role = "";
  try {
    role = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role;
  } catch {
    /* Publishable keys are not JWTs. */
  }
  if (key.startsWith("sb_secret_") || role === "service_role") {
    throw new Error("A secret Supabase key cannot be used as a browser credential.");
  }
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    envDir: projectRoot,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false },
  };
});
