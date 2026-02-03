#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"

const dir = process.cwd()
const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
const workerPath = "./src/cli/cmd/tui/worker.ts"
const bunfsRoot = "B:/~BUN/root/"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "external",
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    //@ts-ignore (bun types aren't up to date)
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: "bun-windows-x64",
    outfile: "dist/opencodexx",
    execArgv: ["--user-agent=opencode/dev", "--use-system-ca", "--"],
    windows: {},
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    OPENCODE_VERSION: "'dev'",
    OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: "'dev'",
    OPENCODE_LIBC: "",
  },
})
console.log("Build complete: dist/opencodexx.exe")
