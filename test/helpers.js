import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const cliPath = join(__dirname, "..", "bin", "scx.js");

export function runScx(args = [], stdin = "", { env } = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.SCX_RATE;
  delete baseEnv.SCX_CURRENCY;
  delete baseEnv.SCX_LOCALE;
  delete baseEnv.SCX_CONFIG;
  baseEnv.XDG_CONFIG_HOME = "/__scx_test_default_xdg_should_not_exist__";
  return spawnSync(process.execPath, [cliPath, ...args], {
    input: stdin,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: env ? { ...baseEnv, ...env } : baseEnv,
  });
}
