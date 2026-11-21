import type { Hallazgo, Paquete, Solicitud, Validacion } from "../types.ts"
import type { Maestros, Proveedor } from "./maestros.ts"
import { dinero, normalizarNit, normalizarNombre } from "./util.ts"

const dia = (iso: string) => iso.slice(0, 10)

/** RC1: por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function resolverProveedor(m: Maestros, s: Solicitud): Proveedor | null {
  if (s.proveedor_nit) {
    const nit = normalizarNit(s.proveedor_nit)
    return m.proveedores.find((p) => normalizarNit(p.nit) === nit) ?? null
  }
  const nombre = normalizarNombre(s.proveedor_nombre)
  return m.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null
}

type Acum = { b: Hallazgo[]; c: Hallazgo[] }

function controlProveedor(m: Maestros, p: Paquete, prov: Proveedor | null, a: Acum) {
  const s = p.solicitud
  if (!prov) {
    a.b.push({
      codigo: "RC1",
      detalle: `El proveedor "${s.proveedor_nombre}" (NIT ${s.proveedor_nit ?? "no informado"}) no existe en el maestro de proveedores. Acción: solicitar alta de proveedor antes de crear la OC.`,
    })
  } else if (!prov.activo) {
    a.b.push({ codigo: "RC1", detalle: `El proveedor ${prov.nombre} (${prov.codigo_sap}) está inactivo en el maestro. Acción: reactivarlo o elegir otro proveedor.` })
  } else if (p.cotizacion?.nit && normalizarNit(p.cotizacion.nit) !== normalizarNit(prov.nit)) {
    a.c.push({ codigo: "RC11", detalle: `El NIT de la cotización (${p.cotizacion.nit}) no coincide con el del maestro (${prov.nit}).` })
  }
}

function controlAprobacion(m: Maestros, p: Paquete, a: Acum) {
  const s = p.solicitud
  const cc = m.centros.find((x) => x.centro_costo === s.centro_costo)
  const ap = p.aprobacion
  if (!ap) {
    a.b.push({ codigo: "RC2", detalle: "No hay evidencia de aprobación del líder. Acción: pedir al solicitante el correo de aprobación." })
    return
  }
  if (!ap.aprobado) a.b.push({ codigo: "RC2", detalle: "El correo de aprobación no contiene la palabra \"Aprobado\"." })
  if (!cc) return
  const email = ap.de.trim().toLowerCase()
  const autorizado = cc.aprobadores.find((x) => x.email.toLowerCase() === email)
  if (!autorizado) {
    const otros = m.centros.filter((x) => x.aprobadores.some((y) => y.email.toLowerCase() === email)).map((x) => x.centro_costo)
    const nota = otros.length ? ` (sí es aprobador de ${otros.join(", ")})` : ""
    a.b.push({
      codigo: "RC2",
      detalle: `${ap.de} no figura como aprobador del centro ${cc.centro_costo}${nota}. Aprobadores válidos: ${cc.aprobadores.map((x) => x.email).join(", ")}. Acción: obtener aprobación de un aprobador del centro.`,
    })
    const maxTope = Math.max(...cc.aprobadores.map((x) => x.tope))
    if (s.valor_total > maxTope) {
      a.b.push({ codigo: "RC3", detalle: `El valor ${dinero(s.valor_total)} excede el tope máximo del centro ${cc.centro_costo} (${dinero(maxTope)}).` })
    }
  } else if (s.valor_total > autorizado.tope) {
    a.b.push({ codigo: "RC3", detalle: `El valor ${dinero(s.valor_total)} excede el tope de ${autorizado.email} (${dinero(autorizado.tope)}).` })
  }
}

function controlEstructura(m: Maestros, p: Paquete, a: Acum) {
  const s = p.solicitud
  const cc = m.centros.find((x) => x.centro_costo === s.centro_costo)
  if (!cc) a.b.push({ codigo: "RC4", detalle: `El centro de costo ${s.centro_costo} no existe en el maestro.` })
  else if (!cc.subareas.some((x) => normalizarNombre(x) === normalizarNombre(s.subarea))) {
    a.b.push({ codigo: "RC4", detalle: `La subárea "${s.subarea}" no pertenece a ${cc.centro_costo}. Subáreas válidas: ${cc.subareas.join(", ")}.` })
  }
  if (Math.abs(s.cantidad * s.valor_unitario - s.valor_total) > 1) {
    a.b.push({ codigo: "RC10", detalle: `cantidad × valor unitario (${dinero(s.cantidad * s.valor_unitario)}) no coincide con el valor total (${dinero(s.valor_total)}).` })
  }
}

function controlMontosYFechas(p: Paquete, a: Acum): boolean {
  const s = p.solicitud
  if (!p.cotizacion) {
    a.c.push({ codigo: "RC5", detalle: "No hay cotización en el paquete (se saltó el paso de cotización)." })
  } else {
    const desvio = Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total
    if (desvio > 0.02) {
      a.c.push({
        codigo: "RC5",
        detalle: `La cotización (${dinero(p.cotizacion.total)}) difiere de la solicitud (${dinero(s.valor_total)}) en ${(desvio * 100).toFixed(1)}%, por encima del 2% permitido.`,
      })
    }
  }
  const retroactiva = !!p.factura && dia(p.factura.fecha) < dia(s.fecha_solicitud)
  if (retroactiva && p.factura) {
    a.c.push({ codigo: "RC8", detalle: `Compra retroactiva: la factura ${p.factura.numero} (${dia(p.factura.fecha)}) es anterior a la solicitud (${dia(s.fecha_solicitud)}).` })
  }
  if (p.aprobacion && dia(p.aprobacion.fecha) < dia(s.fecha_solicitud)) {
    a.c.push({ codigo: "RC9", detalle: `La aprobación (${dia(p.aprobacion.fecha)}) es anterior a la solicitud (${dia(s.fecha_solicitud)}).` })
  }
  return retroactiva
}

function controlDerivados(m: Maestros, s: Solicitud, prov: Proveedor | null, a: Acum): Validacion["derivados"] {
  const d: Validacion["derivados"] = {}
  if (!s.indicador_iva) {
    if (prov) {
      const desc = m.iva.find((i) => i.codigo === prov.indicador_iva_default)?.descripcion ?? ""
      d.indicador_iva = prov.indicador_iva_default
      a.c.push({ codigo: "RC6", detalle: `La solicitud no informa indicador de IVA; se derivó ${prov.indicador_iva_default} (${desc}) del maestro del proveedor. Confirmar.` })
    }
  } else if (!m.iva.some((i) => i.codigo === s.indicador_iva)) {
    a.b.push({ codigo: "RC6", detalle: `El indicador de IVA "${s.indicador_iva}" no existe en el maestro.` })
  }
  if (!s.condiciones_pago) {
    if (prov) d.condiciones_pago = prov.condiciones_pago_default
  } else if (!m.pagos.some((x) => x.codigo === s.condiciones_pago)) {
    a.b.push({ codigo: "RC7", detalle: `Las condiciones de pago "${s.condiciones_pago}" no existen en el maestro.` })
  }
  return d
}

/** Función pura: mismo paquete + mismos maestros = mismo resultado. */
export function validar(m: Maestros, p: Paquete): Validacion {
  const a: Acum = { b: [], c: [] }
  const prov = resolverProveedor(m, p.solicitud)
  controlProveedor(m, p, prov, a)
  controlAprobacion(m, p, a)
  controlEstructura(m, p, a)
  const retroactiva = controlMontosYFechas(p, a)
  const derivados = controlDerivados(m, p.solicitud, prov, a)
  return { apta: a.b.length === 0, bloqueos: a.b, confirmaciones: a.c, derivados, retroactiva }
}
