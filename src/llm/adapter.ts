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

const REINTENTABLES = new Set([429, 500, 502, 503, 504])
const ESPERAS_MS = [1500, 4000]
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Convierte fallos de red/HTTP en mensajes claros. Nunca incluye la clave. Reintenta 2 veces ante 429/5xx transitorios. */
export async function llamarJson(url: string, init: RequestInit, proveedor: string): Promise<unknown> {
  for (let intento = 0; ; intento++) {
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
    if (res.ok) return JSON.parse(texto)
    const espera = ESPERAS_MS[intento]
    if (REINTENTABLES.has(res.status) && espera !== undefined) {
      await pausa(espera)
      continue
    }
    let detalle = texto.slice(0, 300)
    try {
      const j = JSON.parse(texto) as { error?: { message?: string } } | { error?: { message?: string } }[]
      const e = Array.isArray(j) ? j[0]?.error : j.error
      detalle = e?.message ?? detalle
    } catch { /* texto plano */ }
    throw new Error(`El proveedor del modelo (${proveedor}) respondió ${res.status}: ${detalle}. Si es un error de saturación o de límite, espera unos segundos y reintenta; también puedes usar el botón «Ejecutar verificación sin modelo».`)
  }
}
