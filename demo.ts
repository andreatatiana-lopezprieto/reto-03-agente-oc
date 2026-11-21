// Verificación sin modelo: bun install && bun run demo.ts   (o: node --experimental-strip-types demo.ts)
import { readFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { ejecutarHerramienta } from "./src/tools/index.ts"
import type { Ctx, OrdenCompra, Validacion } from "./src/types.ts"

const directory = fileURLToPath(new URL(".", import.meta.url))
const ctx: Ctx = { directory, sessionId: "demo" }

type Resp<T> = { ok: true; data: T } | { ok: false; error: string; requiere_confirmacion?: boolean; detalle?: unknown }
async function llamar<T>(tool: string, args: unknown): Promise<Resp<T>> {
  return JSON.parse(await ejecutarHerramienta(tool, args, ctx)) as Resp<T>
}

type Fila = { caso: string; apta: boolean; bloqueos: string; confirmaciones: string; retro: boolean; resultado: string }
const filas: Fila[] = []
const fallos: string[] = []
const esperar = (cond: boolean, msg: string) => { if (!cond) fallos.push(msg) }
const linea = (t = "") => console.log(t)

async function procesar(caso: string, confirmar: boolean): Promise<Fila> {
  linea(`\n━━━ ${caso} ━━━`)
  const val = await llamar<Validacion>("oc_validar", { caso })
  if (!val.ok) { linea(`  ✖ ${val.error}`); return { caso, apta: false, bloqueos: "-", confirmaciones: "-", retro: false, resultado: `error: ${val.error}` } }
  const v = val.data
  linea(`  apta: ${v.apta} | retroactiva: ${v.retroactiva}`)
  v.bloqueos.forEach((b) => linea(`  ⛔ ${b.codigo}: ${b.detalle}`))
  v.confirmaciones.forEach((c) => linea(`  ⚠️  ${c.codigo}: ${c.detalle}`))
  if (Object.keys(v.derivados).length) linea(`  ↪ derivados: ${JSON.stringify(v.derivados)}`)
  const base = { caso, apta: v.apta, bloqueos: v.bloqueos.map((b) => b.codigo).join(",") || "-", confirmaciones: v.confirmaciones.map((c) => c.codigo).join(",") || "-", retro: v.retroactiva }
  if (!v.apta) { linea("  → NO se crea OC (bloqueada)"); return { ...base, resultado: "BLOQUEADA" } }

  const pay = await llamar<{ payload: OrdenCompra }>("oc_construir_payload", { caso })
  if (!pay.ok) return { ...base, resultado: `error: ${pay.error}` }
  await llamar("oc_generar_evidencia", { caso })
  const payload = pay.data.payload
  linea(`  payload: ${payload.proveedor.nombre} | ${payload.posiciones[0]?.descripcion} | ${payload.condiciones_pago} | IVA ${payload.posiciones[0]?.indicador_iva}`)

  const intento = await llamar<{ numero_oc: string; idempotente: boolean }>("oc_crear", { caso, payload })
  if (intento.ok) { linea(`  ✔ OC ${intento.data.numero_oc} (idempotente: ${intento.data.idempotente})`); return { ...base, resultado: `OC ${intento.data.numero_oc}` } }
  if (!intento.requiere_confirmacion) return { ...base, resultado: `error: ${intento.error}` }

  linea(`  ❓ ${intento.error} Sin confirmar, no se crea.`)
  if (!confirmar) return { ...base, resultado: "PENDIENTE" }
  linea("  👤 El usuario responde: «confirmo»  → oc_crear(confirmado=true)")
  const final = await llamar<{ numero_oc: string; idempotente: boolean }>("oc_crear", { caso, payload, confirmado: true })
  if (!final.ok) return { ...base, resultado: `error: ${final.error}` }
  linea(`  ✔ OC ${final.data.numero_oc} creada tras confirmación`)
  return { ...base, resultado: `OC ${final.data.numero_oc} (confirmada)` }
}

await rm(`${directory}out`, { recursive: true, force: true })
const casos = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]
for (const c of casos) filas.push(await procesar(c, true))

linea("\n━━━ Idempotencia: sol-001 por segunda vez ━━━")
const dos = await llamar<{ numero_oc: string; idempotente: boolean }>("oc_crear", { caso: "sol-001", payload: (await llamar<{ payload: OrdenCompra }>("oc_construir_payload", { caso: "sol-001" }).then((r) => (r.ok ? r.data.payload : null))) })
linea(dos.ok ? `  ✔ devuelve la OC existente ${dos.data.numero_oc} (idempotente: ${dos.data.idempotente})` : `  ✖ ${dos.error}`)

linea("\n━━━ Resumen ━━━")
console.table(filas)
const get = (c: string) => filas.find((f) => f.caso === c)
esperar(get("sol-001")?.resultado.startsWith("OC 4500000001") === true, "sol-001 debe crear la OC 4500000001 sin confirmación")
esperar(get("sol-002")?.bloqueos === "RC1", "sol-002 debe bloquear por RC1")
esperar(get("sol-003")?.bloqueos.includes("RC2") === true, "sol-003 debe bloquear por RC2")
esperar(get("sol-004")?.confirmaciones === "RC5", "sol-004 debe pedir confirmación RC5")
esperar(get("sol-005")?.retro === true && get("sol-005")?.confirmaciones === "RC8", "sol-005 debe ser retroactiva (RC8)")
esperar(get("sol-006")?.confirmaciones === "RC6", "sol-006 debe pedir confirmación RC6")
esperar(dos.ok && dos.data.idempotente && dos.data.numero_oc === "4500000001", "la segunda creación de sol-001 debe ser idempotente")

linea("\nout/control.csv:\n" + (await readFile(`${directory}out/control.csv`, "utf8")))
if (fallos.length) { console.error("✖ Verificaciones fallidas:\n - " + fallos.join("\n - ")); process.exitCode = 1 }
else linea("✔ Todas las verificaciones pasaron")
