import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

export interface DesktopAppOptions {
  devTools?: boolean;
  wait?: boolean;
}

function electronExecutable(): string {
  const require = createRequire(import.meta.url);
  const electron = require("electron");
  if (typeof electron === "string") return electron;
  if (typeof electron === "object" && typeof electron.default === "string") {
    return electron.default;
  }
  throw new Error("Electron executable was not found. Run `npm install` in the Claudex package.");
}

export function launchDesktopApp(opts: DesktopAppOptions = {}): void {
  const entry = join(PKG_ROOT, "dist", "appMain.js");
  const child = spawn(electronExecutable(), [entry], {
    detached: !opts.wait,
    stdio: opts.wait ? "inherit" : "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      CLAUDEX_APP_DEVTOOLS: opts.devTools ? "1" : "",
    },
  });
  if (!opts.wait) child.unref();
  console.log("Claudex app launched.");
}
