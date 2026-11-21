import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
const CentroSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
const IvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
const PagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Proveedor = z.infer<typeof ProveedorSchema>
export type Maestros = {
  proveedores: Proveedor[]
  centros: z.infer<typeof CentroSchema>[]
  iva: z.infer<typeof IvaSchema>[]
  pagos: z.infer<typeof PagoSchema>[]
}

async function leer<T>(root: string, archivo: string, schema: z.ZodType<T>): Promise<T> {
  const ruta = join(root, "fixtures", "reto-03", "maestros", archivo)
  return schema.parse(JSON.parse(await readFile(ruta, "utf8")))
}

export async function cargarMaestros(root: string): Promise<Maestros> {
  const [proveedores, centros, iva, pagos] = await Promise.all([
    leer(root, "proveedores.json", z.array(ProveedorSchema)),
    leer(root, "centros-costo.json", z.array(CentroSchema)),
    leer(root, "indicadores-iva.json", z.array(IvaSchema)),
    leer(root, "condiciones-pago.json", z.array(PagoSchema)),
  ])
  return { proveedores, centros, iva, pagos }
}
