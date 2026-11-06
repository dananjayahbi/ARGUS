import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export default function globalSetup() {
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  execFileSync(process.execPath, ["scripts/test-db.mjs", "setup"], {
    stdio: "inherit",
    env: process.env,
  });
}
