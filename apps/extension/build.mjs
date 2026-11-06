import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "src");
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(source, dist, { recursive: true });

console.log(`Built ARGUS extension to ${dist}`);
