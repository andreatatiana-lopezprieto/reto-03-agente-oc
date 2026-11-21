import { z } from "zod"
import type { HerramientaDef, LlamadaHerramienta, LlmAdapter, Mensaje, ResultadoHerramienta } from "./llm/adapter.ts"
import { aJsonSchema } from "./llm/json-schema.ts"
import { ejecutarHerramienta, herramientas } from "./tools/index.ts"

export type LlamadaVista = { id: string; nombre: string; args: unknown; ok: boolean; resumen: string; requiereConfirmacion: boolean }
export type EntradaHistorial = { rol: "user" | "assistant"; texto: string; toolCalls?: LlamadaVista[]; needsConfirmation?: boolean }
export type Sesion = {
  id: string
  mensajes: Mensaje[]
  historial: EntradaHistorial[]
  tokens: number
  turno: number
  /** caso -> turno en el que se mostró la confirmación al usuario */
  pendientes: Map<string, number>
  ocupada: boolean
}
export type ConfigAgente = { sistema: string; directorio: string; maxIteraciones: number; maxTokensSesion: number }
export type SalidaTurno = { reply: string; toolCalls: LlamadaVista[]; needsConfirmation: boolean }

export function nuevaSesion(id: string, sistema: string): Sesion {
  return { id, mensajes: [{ rol: "system", texto: sistema }], historial: [], tokens: 0, turno: 0, pendientes: new Map(), ocupada: false }
}

const NEGATIVO = /\b(no|cancel\w*|rechaz\w*|espera\w*|detente|det[eé]n\w*)\b/i
const POSITIVO = /\b(confirmo|confirmado|confirmamos|s[ií]|dale|adelante|procede|proceda|apruebo|ok|vale|de acuerdo|cr[eé]ala)\b/i
/** Heurística determinística: el mensaje del usuario es una confirmación explícita. */
export function esConfirmacion(texto: string): boolean {
  return POSITIVO.test(texto) && !NEGATIVO.test(texto)
}

/** Al modelo solo se le exponen los argumentos útiles; los marcados "Opcional." se omiten (ahorra tokens). */
export function definicionesParaModelo(): HerramientaDef[] {
  return Object.values(herramientas).map((h) => {
    const visibles = Object.fromEntries(Object.entries(h.args as z.ZodRawShape).filter(([, v]) => !v.description?.startsWith("Opcional.")))
    return { nombre: h.nombre, descripcion: h.description, parametros: aJsonSchema(z.object(visibles)) }
  })
}

type Salida = { ok?: boolean; error?: string; requiere_confirmacion?: boolean; data?: unknown }
function leerSalida(s: string): Salida {
  try { return JSON.parse(s) as Salida } catch { return { ok: false, error: "salida no legible" } }
}
function resumir(s: Salida): string {
  if (s.ok === false) return s.error ?? "error"
  const t = JSON.stringify(s.data ?? s)
  return t.length > 300 ? t.slice(0, 300) + "…" : t
}
function argsComoObjeto(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {}
}

/** CA3: `confirmado=true` solo se acepta si el usuario confirmó en un turno POSTERIOR al que mostró la pregunta. */
function guardaConfirmacion(s: Sesion, ll: LlamadaHerramienta, usuarioConfirmo: boolean): string | null {
  if (ll.nombre !== "oc_crear" || argsComoObjeto(ll.args).confirmado !== true) return null
  const caso = String(argsComoObjeto(ll.args).caso ?? "")
  const turnoPregunta = s.pendientes.get(caso)
  if (turnoPregunta !== undefined && turnoPregunta < s.turno && usuarioConfirmo) return null
  return JSON.stringify({ ok: false, error: "confirmado=true no permitido: el usuario aún no ha confirmado explícitamente en un mensaje posterior a la pregunta. Muestra las confirmaciones, pregunta y termina el turno.", requiere_confirmacion: true })
}

function actualizarPendientes(s: Sesion, ll: LlamadaHerramienta, salida: Salida) {
  const caso = String(argsComoObjeto(ll.args).caso ?? "")
  if (!caso) return
  const d = salida.data as { apta?: boolean; confirmaciones?: unknown[] } | undefined
  if (ll.nombre === "oc_validar" && salida.ok && d?.apta && (d.confirmaciones?.length ?? 0) > 0 && !s.pendientes.has(caso)) s.pendientes.set(caso, s.turno)
  if (ll.nombre === "oc_crear" && salida.requiere_confirmacion && !s.pendientes.has(caso)) s.pendientes.set(caso, s.turno)
  if (ll.nombre === "oc_crear" && salida.ok) s.pendientes.delete(caso)
}

export async function procesarTurno(s: Sesion, texto: string, llm: LlmAdapter, cfg: ConfigAgente): Promise<SalidaTurno> {
  s.turno += 1
  const vistas: LlamadaVista[] = []
  const usuarioConfirmo = esConfirmacion(texto)
  s.mensajes.push({ rol: "user", texto })
  s.historial.push({ rol: "user", texto })
  const defs = definicionesParaModelo()
  let reply = ""
  try {
    for (let i = 0; ; i++) {
      if (s.tokens >= cfg.maxTokensSesion) { reply = "Se alcanzó el límite de tokens de esta sesión. Inicia una sesión nueva para continuar."; break }
      if (i >= cfg.maxIteraciones) { reply = `Alcancé el tope de ${cfg.maxIteraciones} pasos en este turno. Esto es lo que hice: ${vistas.map((v) => v.nombre).join(" → ") || "nada"}. Dime si quieres que continúe.`; break }
      const r = await llm.enviar(s.mensajes, defs)
      s.tokens += r.tokens.entrada + r.tokens.salida
      if (r.llamadas.length === 0) { reply = r.texto; break }
      s.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: r.llamadas })
      const resultados: ResultadoHerramienta[] = []
      for (const ll of r.llamadas) {
        const bloqueada = guardaConfirmacion(s, ll, usuarioConfirmo)
        const crudo = bloqueada ?? (await ejecutarHerramienta(ll.nombre, ll.args, { directory: cfg.directorio, sessionId: s.id }))
        const salida = leerSalida(crudo)
        actualizarPendientes(s, ll, salida)
        resultados.push({ id: ll.id, nombre: ll.nombre, contenido: crudo })
        vistas.push({ id: ll.id, nombre: ll.nombre, args: ll.args, ok: salida.ok !== false, resumen: resumir(salida), requiereConfirmacion: salida.requiere_confirmacion === true })
      }
      s.mensajes.push({ rol: "tool", resultados })
    }
  } catch (e) {
    // CA5: el error se muestra en lenguaje claro y la sesión sigue viva.
    reply = `⚠️ ${e instanceof Error ? e.message : "Ocurrió un error inesperado."} Puedes reintentar tu mensaje.`
  }
  const ultimo = s.mensajes[s.mensajes.length - 1]
  if (ultimo?.rol !== "assistant") s.mensajes.push({ rol: "assistant", texto: reply, llamadas: [] })
  const needsConfirmation = s.pendientes.size > 0
  s.historial.push({ rol: "assistant", texto: reply, toolCalls: vistas, needsConfirmation })
  return { reply, toolCalls: vistas, needsConfirmation }
}
