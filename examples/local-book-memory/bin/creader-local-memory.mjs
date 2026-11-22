#!/usr/bin/env node
// Runs the TypeScript server through tsx: the vendored narrative-core uses extensionless imports,
// which tsx resolves and plain node does not. A published version would ship compiled code.
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const tsx = createRequire(import.meta.url).resolve("tsx/cli")
const child = spawn(process.execPath, [tsx, join(here, "..", "src", "server.ts"), ...process.argv.slice(2)], { stdio: "inherit" })
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)))
