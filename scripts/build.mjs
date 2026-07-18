import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const root = process.cwd();
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });

await build({
  root,
  build: {
    emptyOutDir: false,
    outDir: resolve(dist, "client"),
  },
});

await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await cp(resolve(root, ".openai", "hosting.json"), resolve(dist, ".openai", "hosting.json"), {
  recursive: false,
});

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
