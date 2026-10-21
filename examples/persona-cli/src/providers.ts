/**
 * @input  Model id (as registered in creader_editor lib/ai/core/models.ts) + env keys
 *         OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY.
 * @output resolveModel(id): an AI SDK LanguageModel; loadEnvFile(): minimal KEY=VALUE loader.
 * @pos    persona-cli — provider wiring mirrors the product's catalog by id prefix only.
 */
import { createAnthropic } from "@ai-sdk/anthropic"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import { readFileSync } from "node:fs"

export type Provider = "openai" | "anthropic" | "deepseek"

export function providerOf(modelId: string): Provider {
  if (modelId.startsWith("claude-")) return "anthropic"
  if (modelId.startsWith("deepseek-")) return "deepseek"
  if (/^(gpt-|o\d)/.test(modelId)) return "openai"
  throw new Error(`persona-cli: no provider for model id "${modelId}"`)
}

const KEY_ENV: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
}

export function resolveModel(modelId: string): LanguageModel {
  const provider = providerOf(modelId)
  const apiKey = process.env[KEY_ENV[provider]]
  if (!apiKey) throw new Error(`persona-cli: ${KEY_ENV[provider]} not set (needed for ${modelId})`)
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(modelId)
    case "anthropic":
      return createAnthropic({ apiKey })(modelId)
    case "deepseek":
      return createDeepSeek({ apiKey })(modelId)
  }
}

/** Reads KEY=VALUE lines into process.env without overriding what is already set. No dotenv dep. */
export function loadEnvFile(path: string): number {
  let n = 0
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) {
      process.env[key] = value
      n++
    }
  }
  return n
}
