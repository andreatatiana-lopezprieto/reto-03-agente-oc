/** Interfaz propia del proveedor LLM: cambiar de proveedor no toca el ciclo del agente. */
export type LlamadaHerramienta = { id: string; nombre: string; args: unknown }
export type ResultadoHerramienta = { id: string; nombre: string; contenido: string }

export type Mensaje =
  | { rol: "system"; texto: string }
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "tool"; resultados: ResultadoHerramienta[] }

export type HerramientaDef = { nombre: string; descripcion: string; parametros: Record<string, unknown> }

export type RespuestaLlm = {
  texto: string
  llamadas: LlamadaHerramienta[]
  tokens: { entrada: number; salida: number }
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: HerramientaDef[]): Promise<RespuestaLlm>
}

export const TIMEOUT_MS = 60_000

/** Convierte fallos de red/HTTP en mensajes claros. Nunca incluye la clave. */
export async function llamarJson(url: string, init: RequestInit, proveedor: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(`El proveedor del modelo (${proveedor}) tardó más de ${TIMEOUT_MS / 1000} s en responder. Intenta de nuevo.`)
    }
    throw new Error(`No se pudo conectar con el proveedor del modelo (${proveedor}).`)
  }
  const texto = await res.text()
  if (!res.ok) {
    let detalle = texto.slice(0, 300)
    try {
      const j = JSON.parse(texto) as { error?: { message?: string } }
      detalle = j.error?.message ?? detalle
    } catch { /* texto plano */ }
    throw new Error(`El proveedor del modelo (${proveedor}) respondió ${res.status}: ${detalle}`)
  }
  return JSON.parse(texto)
}
