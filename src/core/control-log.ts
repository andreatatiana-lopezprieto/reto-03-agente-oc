import { appendFile, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"

export type FilaControl = {
  solicitud_id: string
  resultado: string
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const CABECERA = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"
const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** HU-5: cada intento deja una fila en out/control.csv (lo consume Contabilidad/Auditoría). */
export async function registrarControl(root: string, f: FilaControl): Promise<void> {
  const ruta = join(root, "out", "control.csv")
  await mkdir(join(root, "out"), { recursive: true })
  const existe = await stat(ruta).then(() => true, () => false)
  const fila = [f.solicitud_id, f.resultado, f.numero_oc ?? "", String(f.retroactiva), f.bloqueos.join(";"), f.confirmaciones.join(";"), new Date().toISOString()]
  await appendFile(ruta, (existe ? "" : CABECERA) + fila.map(q).join(",") + "\n", "utf8")
}
