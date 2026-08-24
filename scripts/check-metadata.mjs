#!/usr/bin/env node
/**
 * The version string lives in five places and the server name in two. The MCP
 * Registry hard-rejects a package whose `mcpName` disagrees with server.json,
 * and npm will happily publish a build whose advertised version is a lie.
 * Neither failure is visible until someone tries to install the thing, so the
 * duplication gets its own gate rather than a comment asking people to be careful.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const srv = JSON.parse(read("server.json"))
const index = read("src/index.ts")
const readme = read("README.md")

const errors = []
const eq = (label, a, b) => {
  if (a !== b) errors.push(`${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
}

// Server identity: package.json#mcpName is how the registry proves we own the npm package.
eq("mcpName vs server.json#name", pkg.mcpName, srv.name)
eq("package name vs server.json#packages[0].identifier", pkg.name, srv.packages[0].identifier)

// Version, all five sites.
eq("server.json#version", srv.version, pkg.version)
eq("server.json#packages[0].version", srv.packages[0].version, pkg.version)
const declared = index.match(/name:\s*"creader",\s*version:\s*"([^"]+)"/)
if (!declared) errors.push("src/index.ts: could not find the McpServer version literal")
else eq("src/index.ts McpServer version", declared[1], pkg.version)

// Tool count, as claimed by the README heading, the index.ts comment, and reality.
const actual = (read("src/tools/ai.ts") + read("src/tools/books.ts") + read("src/tools/chapters.ts") +
  read("src/tools/knowledge.ts") + read("src/tools/publishing.ts") + read("src/tools/relations.ts") +
  read("src/tools/stats.ts") + read("src/tools/structure.ts")).match(/server\.tool\(/g)?.length ?? 0
const claimedReadme = Number(readme.match(/^## Tools \((\d+)\)/m)?.[1])
const claimedIndex = Number(index.match(/Register all (\d+) tools/)?.[1])
eq("README '## Tools (n)' vs server.tool() count", claimedReadme, actual)
eq("src/index.ts 'Register all n tools' vs actual", claimedIndex, actual)

if (errors.length) {
  console.error("Metadata is inconsistent:\n" + errors.map((e) => "  - " + e).join("\n"))
  process.exit(1)
}
console.log(`Metadata consistent: ${pkg.name}@${pkg.version} as ${pkg.mcpName}, ${actual} tools.`)
