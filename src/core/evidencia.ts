import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { carpetaCaso } from "./paquete.ts"
import { CASO_VALIDO, fallo, ok, type Resultado } from "./util.ts"

const AprobacionSchema = z.object({
  de: z.string(),
  para: z.string(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})

export type Evidencia = { ruta: string; sha256: string }

/** HU-4 (P0): out/<caso>/aprobacion.txt con encabezados, cuerpo y sha256 del contenido. */
export async function generarEvidencia(root: string, caso: string): Promise<Resultado<Evidencia>> {
  if (!CASO_VALIDO.test(caso)) return fallo(`Nombre de caso inválido: "${caso}"`)
  try {
    const raw = await readFile(join(carpetaCaso(root, caso), "aprobacion.json"), "utf8")
    const a = AprobacionSchema.parse(JSON.parse(raw))
    const contenido = `De: ${a.de}\nPara: ${a.para}\nFecha: ${a.fecha}\nAsunto: ${a.asunto}\n\n${a.cuerpo}`
    const sha256 = createHash("sha256").update(contenido, "utf8").digest("hex")
    const dir = join(root, "out", caso)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "aprobacion.txt"), `${contenido}\n\n---\nsha256: ${sha256}\n`, "utf8")
    return ok({ ruta: `out/${caso}/aprobacion.txt`, sha256 })
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") {
      return fallo("No hay aprobacion.json para generar la evidencia. Pida el correo de aprobación al solicitante.")
    }
    return fallo(`No se pudo generar la evidencia: ${e instanceof Error ? e.message : String(e)}`)
  }
}
