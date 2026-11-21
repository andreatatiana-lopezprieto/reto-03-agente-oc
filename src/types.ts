import { z } from "zod"

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(),
  valor_total: z.number().positive(),
  moneda: z.string(),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "fecha_solicitud debe ser AAAA-MM-DD"),
})

export const PaqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() }),
  solicitud: SolicitudSchema,
  cotizacion: z
    .object({
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      referencia: z.string().nullable().optional(),
      texto: z.string(),
    })
    .nullable(),
  aprobacion: z
    .object({ de: z.string(), fecha: z.string(), aprobado: z.boolean(), texto: z.string() })
    .nullable(),
  factura: z.object({ numero: z.string(), fecha: z.string(), total: z.number() }).nullable(),
})

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int(),
        descripcion: z.string().max(40),
        cantidad: z.number(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})

export type Solicitud = z.infer<typeof SolicitudSchema>
export type Paquete = z.infer<typeof PaqueteSchema>
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

export type Hallazgo = { codigo: string; detalle: string }
export type Derivados = { indicador_iva?: string; condiciones_pago?: string }
export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}
export type Ctx = { directory: string; sessionId: string }
