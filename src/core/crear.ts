import { OrdenCompraSchema, type OrdenCompra } from "../types.ts"
import type { SapAdapter } from "../sap/adapter.ts"
import { registrarControl } from "./control-log.ts"
import { validar } from "./controles.ts"
import { cargarMaestros } from "./maestros.ts"
import { leerPaquete } from "./paquete.ts"
import { construirPayload } from "./payload.ts"
import { canon, fallo, ok, type Resultado } from "./util.ts"

export type OcCreada = { numero_oc: string; fecha: string | null; idempotente: boolean }

/**
 * HU-5. Fuente de verdad = servidor: se relee, revalida y reconstruye todo desde `caso`.
 * El payload recibido solo se acepta si es idéntico al validado (el modelo no puede alterar montos).
 */
export async function crearOC(
  root: string,
  sap: SapAdapter,
  caso: string,
  payloadRecibido: OrdenCompra,
  confirmado: boolean,
  usuario: string,
): Promise<Resultado<OcCreada>> {
  const lectura = await leerPaquete(root, caso)
  if (!lectura.ok) return lectura
  const p = lectura.data
  const id = p.solicitud.solicitud_id

  const existente = await sap.buscarOrdenPorReferencia(id)
  if (existente) {
    await registrarControl(root, { solicitud_id: id, resultado: "idempotente", numero_oc: existente.numero_oc, retroactiva: !!p.factura, bloqueos: [], confirmaciones: [] })
    return ok({ numero_oc: existente.numero_oc, fecha: existente.fecha ?? null, idempotente: true })
  }

  const m = await cargarMaestros(root)
  const v = validar(m, p)
  const base = { solicitud_id: id, retroactiva: v.retroactiva, bloqueos: v.bloqueos.map((x) => x.codigo), confirmaciones: v.confirmaciones.map((x) => x.codigo) }

  if (!v.apta) {
    await registrarControl(root, { ...base, resultado: "bloqueada", numero_oc: null })
    return fallo(`No se crea la OC: ${v.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" | ")}`, { detalle: v.bloqueos })
  }
  if (v.confirmaciones.length > 0 && !confirmado) {
    await registrarControl(root, { ...base, resultado: "pendiente_confirmacion", numero_oc: null })
    return fallo("Se requiere confirmación humana antes de crear la OC.", { requiere_confirmacion: true, detalle: v.confirmaciones })
  }

  const construido = await construirPayload(root, caso, p, v, m)
  if (!construido.ok) return construido
  if (canon(OrdenCompraSchema.parse(payloadRecibido)) !== canon(construido.data.payload)) {
    return fallo("El payload recibido no coincide con el validado por el sistema. Genérelo de nuevo con oc_construir_payload.")
  }

  const orden: OrdenCompra = {
    ...construido.data.payload,
    excepciones: construido.data.payload.excepciones.map((e) => ({ ...e, confirmado_por: usuario })),
  }
  const { numero_oc, fecha } = await sap.crearOrden(orden)
  await registrarControl(root, { ...base, resultado: "creada", numero_oc })
  return ok({ numero_oc, fecha, idempotente: false })
}
