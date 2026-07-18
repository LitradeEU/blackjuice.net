import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const root = process.cwd();
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });

await build({
  root,
  base: process.env.GITHUB_ACTIONS === "true" ? "/blackjuice.net/" : "/",
  build: {
    emptyOutDir: false,
    outDir: resolve(dist, "client"),
  },
});

await mkdir(resolve(dist, "server"), { recursive: true });
const hostingConfig = resolve(root, ".openai", "hosting.json");

try {
  await access(hostingConfig);
  await mkdir(resolve(dist, ".openai"), { recursive: true });
  await cp(hostingConfig, resolve(dist, ".openai", "hosting.json"), { recursive: false });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await writeFile(
  resolve(dist, "server", "index.js"),
  `const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || new URL(request.url).pathname.includes(".")) return response;
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};

export default worker;
`,
);
