import { llamarJson, type HerramientaDef, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

type MsgO =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string }
type RespO = {
  choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function convertir(mensajes: Mensaje[]): MsgO[] {
  const out: MsgO[] = []
  for (const m of mensajes) {
    if (m.rol === "system") out.push({ role: "system", content: m.texto })
    else if (m.rol === "user") out.push({ role: "user", content: m.texto })
    else if (m.rol === "assistant") {
      const tool_calls = m.llamadas.map((l) => ({ id: l.id, type: "function" as const, function: { name: l.nombre, arguments: JSON.stringify(l.args ?? {}) } }))
      out.push({ role: "assistant", content: m.texto || null, ...(tool_calls.length ? { tool_calls } : {}) })
    } else for (const r of m.resultados) out.push({ role: "tool", tool_call_id: r.id, content: r.contenido })
  }
  return out
}

function parseArgs(s: string): unknown {
  try { return JSON.parse(s || "{}") } catch { return {} }
}

/** Compatible con OpenAI y con cualquier API "chat completions" (LLM_BASE_URL). */
export class OpenAiAdapter implements LlmAdapter {
  readonly proveedor = "openai"
  readonly modelo: string
  private clave: string
  private baseUrl: string
  constructor(clave: string, modelo: string, baseUrl = "https://api.openai.com/v1") {
    this.clave = clave
    this.modelo = modelo
    this.baseUrl = baseUrl.replace(/\/$/, "")
  }

  async enviar(mensajes: Mensaje[], herramientas: HerramientaDef[]): Promise<RespuestaLlm> {
    const cuerpo = {
      model: this.modelo,
      messages: convertir(mensajes),
      tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } })),
    }
    const r = (await llamarJson(
      `${this.baseUrl}/chat/completions`,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.clave}` }, body: JSON.stringify(cuerpo) },
      "OpenAI",
    )) as RespO
    const msg = r.choices[0]?.message
    if (!msg) throw new Error("El proveedor del modelo (OpenAI) devolvió una respuesta vacía.")
    const llamadas = (msg.tool_calls ?? []).map((t) => ({ id: t.id, nombre: t.function.name, args: parseArgs(t.function.arguments) }))
    return { texto: msg.content ?? "", llamadas, tokens: { entrada: r.usage?.prompt_tokens ?? 0, salida: r.usage?.completion_tokens ?? 0 } }
  }
}
