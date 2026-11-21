import { z } from "zod"
import { MockSapAdapter } from "../sap/mock.ts"
import { registrarControl } from "../core/control-log.ts"
import { validar as validarControles } from "../core/controles.ts"
import { crearOC } from "../core/crear.ts"
import { generarEvidencia } from "../core/evidencia.ts"
import { cargarMaestros } from "../core/maestros.ts"
import { leerPaquete } from "../core/paquete.ts"
import { construirPayload } from "../core/payload.ts"
import { fallo, type Resultado } from "../core/util.ts"
import { OrdenCompraSchema, PaqueteSchema, type Ctx } from "../types.ts"

type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>

/** Garantiza el contrato: execute devuelve siempre un string JSON y nunca lanza. */
async function seguro<T>(fn: () => Promise<Resultado<T>>): Promise<string> {
  try {
    return JSON.stringify(await fn())
  } catch (e) {
    return JSON.stringify(fallo(`Error inesperado: ${e instanceof Error ? e.message : String(e)}`))
  }
}

const caso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. sol-001)")
const paqueteOpcional = PaqueteSchema.optional().describe(
  "Opcional. El sistema siempre relee el paquete desde el caso; no se usan valores enviados por el modelo.",
)

const argsLeer = { caso }
export const leer_paquete = {
  description: "Lee y normaliza el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe).",
  args: argsLeer,
  async execute(args: Args<typeof argsLeer>, ctx: Ctx) {
    return seguro(() => leerPaquete(ctx.directory, args.caso))
  },
}

const argsValidar = { caso, paquete: paqueteOpcional }
export const validar = {
  description: "Valida el paquete contra maestros y controles RC1–RC10; devuelve bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: argsValidar,
  async execute(args: Args<typeof argsValidar>, ctx: Ctx) {
    return seguro(async () => {
      const lectura = await leerPaquete(ctx.directory, args.caso)
      if (!lectura.ok) return lectura
      const v = validarControles(await cargarMaestros(ctx.directory), lectura.data)
      const resultado = v.apta ? (v.confirmaciones.length ? "pendiente_confirmacion" : "apta") : "bloqueada"
      await registrarControl(ctx.directory, {
        solicitud_id: lectura.data.solicitud.solicitud_id,
        resultado: `validacion_${resultado}`,
        numero_oc: null,
        retroactiva: v.retroactiva,
        bloqueos: v.bloqueos.map((b) => b.codigo),
        confirmaciones: v.confirmaciones.map((c) => c.codigo),
      })
      return { ok: true as const, data: v }
    })
  },
}

const argsPayload = {
  caso,
  paquete: paqueteOpcional,
  derivados: z.record(z.string(), z.string()).optional().describe("Opcional. El sistema recalcula los derivados desde los maestros."),
}
export const construir_payload = {
  description: "Construye la OC tal como quedaría en SAP (con trazabilidad por campo); falla si hay bloqueos.",
  args: argsPayload,
  async execute(args: Args<typeof argsPayload>, ctx: Ctx) {
    return seguro(async () => {
      const lectura = await leerPaquete(ctx.directory, args.caso)
      if (!lectura.ok) return lectura
      const m = await cargarMaestros(ctx.directory)
      return construirPayload(ctx.directory, args.caso, lectura.data, validarControles(m, lectura.data), m)
    })
  },
}

const argsEvidencia = { caso }
export const generar_evidencia = {
  description: "Genera la evidencia de aprobación (out/<caso>/aprobacion.txt) con su sha256.",
  args: argsEvidencia,
  async execute(args: Args<typeof argsEvidencia>, ctx: Ctx) {
    return seguro(() => generarEvidencia(ctx.directory, args.caso))
  },
}

const argsCrear = {
  caso,
  payload: OrdenCompraSchema.describe("Payload exacto devuelto por oc_construir_payload, sin modificar."),
  confirmado: z.boolean().optional().describe("true SOLO si el usuario confirmó explícitamente las confirmaciones pendientes en su último mensaje."),
}
export const crear = {
  description: "Crea la OC en SAP simulado; exige apta=true y confirmado=true si hay confirmaciones; es idempotente por solicitud_id.",
  args: argsCrear,
  async execute(args: Args<typeof argsCrear>, ctx: Ctx) {
    return seguro(() => crearOC(ctx.directory, new MockSapAdapter(ctx.directory), args.caso, args.payload, args.confirmado === true, `analista:${ctx.sessionId}`))
  },
}
