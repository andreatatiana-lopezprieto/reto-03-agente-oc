import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { OrdenCompraSchema, type OrdenCompra, type Validacion } from "../types.ts"
import { resolverProveedor } from "./controles.ts"
import { generarEvidencia } from "./evidencia.ts"
import type { Maestros } from "./maestros.ts"
import type { PaqueteLeido } from "./paquete.ts"
import { fallo, ok, type Resultado } from "./util.ts"

export type PayloadConTraza = { payload: OrdenCompra; trazabilidad: string; fuentes: Record<string, string> }

function inferirUnidad(p: PaqueteLeido): "UN" | "H" | "MES" {
  const item = p.cotizacion?.texto.match(/^\d+\.\s*([^|\n]+)/m)?.[1] ?? ""
  if (/^hora/i.test(item.trim())) return "H"
  if (/^(mes|mensualidad)/i.test(item.trim())) return "MES"
  return "UN"
}

/** HU-3: construye el payload; cada valor queda trazado a su fuente en out/<caso>/trazabilidad.json. */
export async function construirPayload(
  root: string,
  caso: string,
  p: PaqueteLeido,
  v: Validacion,
  m: Maestros,
): Promise<Resultado<PayloadConTraza>> {
  if (!v.apta) return fallo("No se construye el payload: la solicitud tiene bloqueos. Corrija o devuelva al solicitante.", { detalle: v.bloqueos })
  const prov = resolverProveedor(m, p.solicitud)
  if (!prov || !p.aprobacion) return fallo("Faltan proveedor o aprobación para construir el payload.")
  const ev = await generarEvidencia(root, caso)
  if (!ev.ok) return ev

  const s = p.solicitud
  const condiciones = s.condiciones_pago ?? v.derivados.condiciones_pago
  const iva = s.indicador_iva ?? v.derivados.indicador_iva
  if (!condiciones || !iva) return fallo("No fue posible determinar condiciones de pago o indicador de IVA.")

  const candidato: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre },
    moneda: s.moneda as OrdenCompra["moneda"],
    condiciones_pago: condiciones,
    aprobador: { email: p.aprobacion.de.trim().toLowerCase(), fecha_aprobacion: p.aprobacion.fecha, evidencia_sha256: ev.data.sha256 },
    posiciones: [
      {
        numero: 10,
        descripcion: s.descripcion.slice(0, 40).trim(),
        cantidad: s.cantidad,
        unidad: inferirUnidad(p),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  }
  const parsed = OrdenCompraSchema.safeParse(candidato)
  if (!parsed.success) {
    return fallo(`El payload no cumple el esquema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
  }

  const fuentes: Record<string, string> = {
    "referencia.solicitud_id": "solicitud",
    "referencia.correo_id": "correo",
    "referencia.cotizacion_ref": p.cotizacion ? "cotizacion" : "derivado (sin cotización)",
    sociedad: "derivado (constante del reto)",
    organizacion_compras: "derivado (constante del reto)",
    "proveedor.*": "maestro.proveedores",
    moneda: "solicitud",
    condiciones_pago: s.condiciones_pago ? "solicitud" : "derivado (maestro.proveedores)",
    "aprobador.email": "aprobacion",
    "aprobador.fecha_aprobacion": "aprobacion",
    "aprobador.evidencia_sha256": "derivado (sha256 de la evidencia)",
    "posiciones[0].descripcion": s.descripcion.length > 40 ? "solicitud (truncada a 40)" : "solicitud",
    "posiciones[0].cantidad": "solicitud",
    "posiciones[0].unidad": "derivado (ítem de la cotización)",
    "posiciones[0].precio_unitario": "solicitud",
    "posiciones[0].centro_costo": "solicitud",
    "posiciones[0].subarea": "solicitud",
    "posiciones[0].indicador_iva": s.indicador_iva ? "solicitud" : "derivado (maestro.proveedores)",
    excepciones: "derivado (oc_validar)",
  }
  const dir = join(root, "out", caso)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "trazabilidad.json"), JSON.stringify(fuentes, null, 2), "utf8")
  return ok({ payload: parsed.data, trazabilidad: `out/${caso}/trazabilidad.json`, fuentes })
}
