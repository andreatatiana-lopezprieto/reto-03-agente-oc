import { join } from "node:path"
import { z } from "zod"
import { PaqueteSchema, SolicitudSchema, type Paquete } from "../types.ts"
import { CASO_VALIDO, aNumero, fallo, leerTextoOpcional, ok, type Resultado } from "./util.ts"

export type PaqueteLeido = Paquete & { faltantes: string[] }

const CorreoSchema = z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() })
const AprobacionSchema = z.object({ de: z.string(), fecha: z.string(), asunto: z.string(), cuerpo: z.string() })

export function carpetaCaso(root: string, caso: string): string {
  return join(root, "fixtures", "reto-03", "solicitudes", caso)
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number)
  const f = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + dias))
  return f.toISOString().slice(0, 10)
}

export function esAprobado(cuerpo: string): boolean {
  if (/\bno\s+(est[aá]\s+)?aprobad[oa]\b/i.test(cuerpo)) return false
  return /\baprobad[oa]\b/i.test(cuerpo)
}

function parseCotizacion(texto: string): Paquete["cotizacion"] {
  const proveedor = texto.match(/^Proveedor:\s*(.+)$/m)?.[1]?.trim()
  const lineaTotal = texto.match(/^TOTAL[^:\n]*:\s*(.+)$/m)?.[1]
  const total = lineaTotal ? aNumero(lineaTotal.replace(/[A-Za-z]/g, "")) : NaN
  if (!proveedor || !Number.isFinite(total)) return null
  const fecha = texto.match(/^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)?.[1]
  const dias = Number(texto.match(/Validez de la oferta:\s*(\d+)/i)?.[1])
  return {
    proveedor,
    nit: texto.match(/^NIT:\s*([\d.]+(?:-\d)?)/m)?.[1] ?? null,
    total,
    moneda: /\bUSD\b/.test(lineaTotal ?? "") ? "USD" : "COP",
    validez_hasta: fecha && Number.isFinite(dias) ? sumarDias(fecha, dias) : null,
    referencia: texto.match(/^COTIZACI[ÓO]N\s+(\S+)/m)?.[1] ?? null,
    texto,
  }
}

function parseFactura(texto: string): Paquete["factura"] {
  const numero = texto.match(/No\.\s*(\S+)/)?.[1]
  const fecha = texto.match(/Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
  const total = aNumero((texto.match(/^TOTAL[^:\n]*:\s*(.+)$/m)?.[1] ?? "").replace(/[A-Za-z]/g, ""))
  return numero && fecha && Number.isFinite(total) ? { numero, fecha, total } : null
}

async function jsonOpcional(ruta: string): Promise<{ valor: unknown } | null> {
  const t = await leerTextoOpcional(ruta)
  return t === null ? null : { valor: JSON.parse(t) }
}

export async function leerPaquete(root: string, caso: string): Promise<Resultado<PaqueteLeido>> {
  if (!CASO_VALIDO.test(caso)) return fallo(`Nombre de caso inválido: "${caso}"`)
  const dir = carpetaCaso(root, caso)
  const faltantes: string[] = []
  try {
    const correoRaw = await jsonOpcional(join(dir, "correo.json"))
    const solRaw = await jsonOpcional(join(dir, "solicitud.json"))
    if (!correoRaw || !solRaw) {
      const quien = [!correoRaw && "correo.json", !solRaw && "solicitud.json"].filter(Boolean).join(", ")
      return fallo(`El caso "${caso}" no existe o está incompleto: falta ${quien}. Pida al solicitante reenviar el paquete.`)
    }
    const correo = CorreoSchema.parse(correoRaw.valor)
    const solicitud = SolicitudSchema.parse(solRaw.valor)

    const cotTxt = await leerTextoOpcional(join(dir, "cotizacion.txt"))
    const cotizacion = cotTxt === null ? null : parseCotizacion(cotTxt)
    if (cotTxt === null) faltantes.push("cotizacion.txt")
    else if (!cotizacion) return fallo("cotizacion.txt no tiene proveedor o total legible. Pida al proveedor una cotización legible.")

    const aprRaw = await jsonOpcional(join(dir, "aprobacion.json"))
    let aprobacion: Paquete["aprobacion"] = null
    if (!aprRaw) faltantes.push("aprobacion.json")
    else {
      const a = AprobacionSchema.parse(aprRaw.valor)
      aprobacion = { de: a.de, fecha: a.fecha, aprobado: esAprobado(a.cuerpo), texto: a.cuerpo }
    }

    const facTxt = await leerTextoOpcional(join(dir, "factura.txt"))
    const factura = facTxt === null ? null : parseFactura(facTxt)
    if (facTxt !== null && !factura) return fallo("factura.txt existe pero no se pudo leer número, fecha y total.")

    const paquete = PaqueteSchema.parse({ correo, solicitud, cotizacion, aprobacion, factura })
    return ok({ ...paquete, faltantes })
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
      return fallo(`Datos inválidos en el paquete (${msg}). Pida al solicitante corregir esos campos.`)
    }
    if (e instanceof SyntaxError) return fallo(`JSON malformado en el paquete: ${e.message}`)
    return fallo(`No se pudo leer el paquete: ${e instanceof Error ? e.message : String(e)}`)
  }
}
