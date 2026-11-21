import { llamarJson, type HerramientaDef, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
type MsgA = { role: "user" | "assistant"; content: string | Bloque[] }
type RespA = { content: Bloque[]; usage?: { input_tokens?: number; output_tokens?: number } }

function convertir(mensajes: Mensaje[]): { system: string; messages: MsgA[] } {
  let system = ""
  const messages: MsgA[] = []
  for (const m of mensajes) {
    if (m.rol === "system") system += (system ? "\n\n" : "") + m.texto
    else if (m.rol === "user") messages.push({ role: "user", content: m.texto })
    else if (m.rol === "assistant") {
      const bloques: Bloque[] = []
      if (m.texto.trim()) bloques.push({ type: "text", text: m.texto })
      for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.args })
      if (bloques.length) messages.push({ role: "assistant", content: bloques })
    } else {
      messages.push({ role: "user", content: m.resultados.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.contenido })) })
    }
  }
  return { system, messages }
}

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  readonly modelo: string
  private clave: string
  constructor(clave: string, modelo: string) {
    this.clave = clave
    this.modelo = modelo
  }

  async enviar(mensajes: Mensaje[], herramientas: HerramientaDef[]): Promise<RespuestaLlm> {
    const { system, messages } = convertir(mensajes)
    const cuerpo = {
      model: this.modelo,
      max_tokens: 2048,
      system,
      messages,
      tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros })),
    }
    const r = (await llamarJson(
      "https://api.anthropic.com/v1/messages",
      { method: "POST", headers: { "content-type": "application/json", "x-api-key": this.clave, "anthropic-version": "2023-06-01" }, body: JSON.stringify(cuerpo) },
      "Anthropic",
    )) as RespA
    const texto = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
    const llamadas = r.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, nombre: b.name, args: b.input }] : []))
    return { texto, llamadas, tokens: { entrada: r.usage?.input_tokens ?? 0, salida: r.usage?.output_tokens ?? 0 } }
  }
}
