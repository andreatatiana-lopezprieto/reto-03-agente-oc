// Verificación sin modelo, ejecutable desde el servidor: mismos 6 casos y mismas herramientas que demo.ts.
// Trabaja en un directorio temporal aislado (fixtures enlazados, out/ propio) y no toca el estado de los chats.
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ejecutarHerramienta } from "./tools/index.ts"
import type { Ctx, OrdenCompra, Validacion } from "./types.ts"

type Resp<T> = { ok: true; data: T } | { ok: false; error: string; requiere_confirmacion?: boolean }
type Hallazgo = { codigo: string; detalle: string }

export type CasoDemo = {
  caso: string
  apta: boolean
  retroactiva: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Record<string, string>
  resultado: string
}
export type SalidaDemo = { casos: CasoDemo[]; idempotencia: string; control: string; verificaciones: { ok: boolean; texto: string }[] }

const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]

export async function ejecutarDemo(root: string): Promise<SalidaDemo> {
  const dir = await mkdtemp(join(tmpdir(), "demo-oc-"))
  try {
    await symlink(join(root, "fixtures"), join(dir, "fixtures"), "dir")
    const ctx: Ctx = { directory: dir, sessionId: "demo-web" }
    const llamar = async <T>(tool: string, args: unknown) => JSON.parse(await ejecutarHerramienta(tool, args, ctx)) as Resp<T>

    const casos: CasoDemo[] = []
    for (const caso of CASOS) {
      const val = await llamar<Validacion>("oc_validar", { caso })
      if (!val.ok) { casos.push({ caso, apta: false, retroactiva: false, bloqueos: [], confirmaciones: [], derivados: {}, resultado: `Error: ${val.error}` }); continue }
      const v = val.data
      const base = { caso, apta: v.apta, retroactiva: v.retroactiva, bloqueos: v.bloqueos, confirmaciones: v.confirmaciones, derivados: v.derivados as Record<string, string> }
      if (!v.apta) { casos.push({ ...base, resultado: "BLOQUEADA: no se crea la OC" }); continue }
      const pay = await llamar<{ payload: OrdenCompra }>("oc_construir_payload", { caso })
      if (!pay.ok) { casos.push({ ...base, resultado: `Error: ${pay.error}` }); continue }
      const payload = pay.data.payload
      const primero = await llamar<{ numero_oc: string }>("oc_crear", { caso, payload })
      if (primero.ok) { casos.push({ ...base, resultado: `OC ${primero.data.numero_oc} creada sin intervención` }); continue }
      if (!primero.requiere_confirmacion) { casos.push({ ...base, resultado: `Error: ${primero.error}` }); continue }
      const final = await llamar<{ numero_oc: string }>("oc_crear", { caso, payload, confirmado: true })
      casos.push({ ...base, resultado: final.ok ? `Pidió confirmación (sin confirmar NO se crea) → tras «confirmo»: OC ${final.data.numero_oc}` : `Error: ${final.error}` })
    }

    const pay1 = await llamar<{ payload: OrdenCompra }>("oc_construir_payload", { caso: "sol-001" })
    const dos = pay1.ok ? await llamar<{ numero_oc: string; idempotente: boolean }>("oc_crear", { caso: "sol-001", payload: pay1.data.payload }) : null
    const idempotencia = dos?.ok ? `sol-001 por segunda vez devuelve la OC existente ${dos.data.numero_oc} (idempotente: ${dos.data.idempotente})` : "No se pudo verificar la idempotencia"

    const g = (c: string) => casos.find((x) => x.caso === c)
    const cod = (h: Hallazgo[]) => h.map((x) => x.codigo).join(",")
    const verificaciones = [
      { ok: g("sol-001")?.resultado.includes("4500000001") === true, texto: "sol-001 crea la OC 4500000001 sin confirmación" },
      { ok: cod(g("sol-002")?.bloqueos ?? []) === "RC1", texto: "sol-002 bloquea por RC1 (proveedor inexistente)" },
      { ok: cod(g("sol-003")?.bloqueos ?? []).includes("RC2"), texto: "sol-003 bloquea por RC2 (aprobador sin autoridad)" },
      { ok: cod(g("sol-004")?.confirmaciones ?? []) === "RC5", texto: "sol-004 pide confirmación RC5 (cotización ≠ solicitud)" },
      { ok: g("sol-005")?.retroactiva === true && cod(g("sol-005")?.confirmaciones ?? []) === "RC8", texto: "sol-005 queda marcada retroactiva (RC8)" },
      { ok: cod(g("sol-006")?.confirmaciones ?? []) === "RC6", texto: "sol-006 pide confirmación RC6 (IVA derivado)" },
      { ok: dos?.ok === true && dos.data.idempotente && dos.data.numero_oc === "4500000001", texto: "Idempotencia: la segunda creación de sol-001 no duplica la OC" },
    ]
    const control = (await readFile(join(dir, "out", "control.csv"), "utf8")).trim()
    return { casos, idempotencia, control, verificaciones }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
