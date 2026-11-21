// Prueba del ciclo del agente SIN proveedor real, con un LLM guionado: bun run verificar-agente.ts
import { readFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { nuevaSesion, procesarTurno, esConfirmacion, type ConfigAgente } from "./src/agente.ts"
import type { LlmAdapter, Mensaje, RespuestaLlm } from "./src/llm/adapter.ts"

const directorio = fileURLToPath(new URL(".", import.meta.url))
const cfg = (max = 25, tokens = 60_000): ConfigAgente => ({ sistema: "test", directorio, maxIteraciones: max, maxTokensSesion: tokens })
const fallos: string[] = []
const verificar = (c: boolean, m: string) => { console.log(`${c ? "✔" : "✖"} ${m}`); if (!c) fallos.push(m) }

type Guion = (m: Mensaje[], paso: number) => Omit<RespuestaLlm, "tokens">
function llmGuionado(g: Guion): LlmAdapter {
  let paso = 0
  return { proveedor: "guion", modelo: "test", async enviar(m) { return { ...g(m, paso++), tokens: { entrada: 10, salida: 10 } } } }
}
const ultimoResultado = (m: Mensaje[], nombre: string): unknown => {
  for (const x of [...m].reverse()) if (x.rol === "tool") { const r = x.resultados.find((y) => y.nombre === nombre); if (r) return JSON.parse(r.contenido) }
  return null
}
const llamar = (id: string, nombre: string, args: unknown) => ({ texto: "", llamadas: [{ id, nombre, args }] })

await rm(`${directorio}out`, { recursive: true, force: true })

// 1) Guarda de confirmación: el modelo intenta saltarse al usuario.
const trampa = llmGuionado((m, p) => {
  if (p === 0) return llamar("a", "oc_validar", { caso: "sol-004" })
  if (p === 1) return llamar("b", "oc_construir_payload", { caso: "sol-004" })
  if (p === 2) { const pay = (ultimoResultado(m, "oc_construir_payload") as { data: { payload: unknown } }).data.payload; return llamar("c", "oc_crear", { caso: "sol-004", payload: pay, confirmado: true }) }
  return { texto: "Hay una excepción RC5. ¿Confirmas que cree la OC?", llamadas: [] }
})
const s = nuevaSesion("sesion-prueba-1", "test")
const t1 = await procesarTurno(s, "Procesa sol-004 y confirmo todo de una vez", trampa, cfg())
verificar(t1.toolCalls.at(-1)?.ok === false && t1.needsConfirmation, "El modelo NO puede crear con confirmado=true en el mismo turno (la pregunta aún no se mostró)")

// 2) Turno siguiente: el usuario confirma y ahora sí se crea.
const confirmar = llmGuionado((m, p) => {
  if (p === 0) { const pay = (ultimoResultado(m, "oc_construir_payload") as { data: { payload: unknown } }).data.payload; return llamar("d", "oc_crear", { caso: "sol-004", payload: pay, confirmado: true }) }
  return { texto: "Listo.", llamadas: [] }
})
const t2 = await procesarTurno(s, "Confirmo", confirmar, cfg())
verificar(t2.toolCalls[0]?.ok === true && !t2.needsConfirmation, "Tras «Confirmo» en un turno posterior, la OC se crea")

// 3) Un mensaje que dice que no, no cuenta como confirmación.
verificar(!esConfirmacion("no la crees hasta que yo lo confirme") && esConfirmacion("sí, créala") && esConfirmacion("Confirmo."), "Heurística de confirmación (positivos y negativos)")

// 4) Modelo que altera un monto: el sistema lo rechaza.
const s2 = nuevaSesion("sesion-prueba-2", "test")
const alterado = llmGuionado((m, p) => {
  if (p === 0) return llamar("e", "oc_construir_payload", { caso: "sol-001" })
  if (p === 1) { const pay = JSON.parse(JSON.stringify((ultimoResultado(m, "oc_construir_payload") as { data: { payload: { posiciones: { precio_unitario: number }[] } } }).data.payload)); pay.posiciones[0].precio_unitario = 1; return llamar("f", "oc_crear", { caso: "sol-001", payload: pay }) }
  return { texto: "fin", llamadas: [] }
})
const t3 = await procesarTurno(s2, "Procesa sol-001", alterado, cfg())
verificar(t3.toolCalls[1]?.ok === false && /no coincide/.test(t3.toolCalls[1]?.resumen ?? ""), "Un payload alterado por el modelo es rechazado")

// 5) Argumentos inválidos se devuelven al modelo como error legible.
const s3 = nuevaSesion("sesion-prueba-3", "test")
const malos = llmGuionado((_m, p) => (p === 0 ? llamar("g", "oc_leer_paquete", { caso: 123 }) : { texto: "ok", llamadas: [] }))
const t4 = await procesarTurno(s3, "x", malos, cfg())
verificar(t4.toolCalls[0]?.ok === false && /inválidos/.test(t4.toolCalls[0]?.resumen ?? ""), "Argumentos inválidos → error de zod devuelto al modelo")

// 6) Tope de iteraciones.
const s4 = nuevaSesion("sesion-prueba-4", "test")
const bucle = llmGuionado((_m, p) => llamar(`h${p}`, "oc_leer_paquete", { caso: "sol-001" }))
const t5 = await procesarTurno(s4, "x", bucle, cfg(3))
verificar(t5.reply.includes("tope de 3 pasos") && t5.toolCalls.length === 3, "El tope de iteraciones corta el bucle con un resumen")

// 7) Error del proveedor: se muestra en el chat y la sesión sigue viva.
const s5 = nuevaSesion("sesion-prueba-5", "test")
const roto: LlmAdapter = { proveedor: "x", modelo: "x", async enviar() { throw new Error("El proveedor del modelo (x) tardó demasiado.") } }
const t6 = await procesarTurno(s5, "hola", roto, cfg())
const t7 = await procesarTurno(s5, "otra vez", llmGuionado(() => ({ texto: "ya estoy", llamadas: [] })), cfg())
verificar(t6.reply.includes("tardó demasiado") && t7.reply === "ya estoy", "Error del LLM → mensaje claro y la sesión sigue funcionando")

// 8) Tope de tokens por sesión.
const s6 = nuevaSesion("sesion-prueba-6", "test")
const t8 = await procesarTurno(s6, "x", llmGuionado(() => ({ texto: "no debería", llamadas: [] })), cfg(25, 0))
verificar(t8.reply.includes("límite de tokens"), "Tope de tokens por sesión")

const control = await readFile(`${directorio}out/control.csv`, "utf8")
verificar(!/sol-004.*creada.*\n.*sol-004.*creada/i.test(control) && (control.match(/creada/g) ?? []).length === 1, "Solo se creó UNA OC en todo el escenario")
if (fallos.length) { console.error(`\n${fallos.length} verificación(es) fallida(s)`); process.exitCode = 1 } else console.log("\n✔ Ciclo del agente verificado")
