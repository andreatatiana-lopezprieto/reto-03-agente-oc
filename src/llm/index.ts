import type { LlmAdapter } from "./adapter.ts"
import { AnthropicAdapter } from "./anthropic.ts"
import { OpenAiAdapter } from "./openai.ts"

/** Devuelve null si no hay clave configurada (el servidor lo informa en el chat, sin caerse). */
export function crearLlm(env: Record<string, string | undefined>): LlmAdapter | null {
  const clave = env.LLM_API_KEY
  if (!clave) return null
  const proveedor = (env.LLM_PROVIDER ?? "anthropic").toLowerCase()
  if (proveedor === "anthropic") return new AnthropicAdapter(clave, env.LLM_MODEL || "claude-sonnet-5-5")
  if (proveedor === "openai") return new OpenAiAdapter(clave, env.LLM_MODEL || "gpt-4o-mini", env.LLM_BASE_URL || undefined)
  throw new Error(`LLM_PROVIDER no soportado: ${proveedor}. Usa "anthropic" u "openai".`)
}
