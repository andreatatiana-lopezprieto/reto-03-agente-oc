import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { OrdenCompra } from "../types.ts"
import { cargarMaestros } from "../core/maestros.ts"
import { leerTextoOpcional, normalizarNit } from "../core/util.ts"
import type { SapAdapter } from "./adapter.ts"

type Registro = { numero_oc: string; fecha: string; orden: OrdenCompra }
const PRIMER_NUMERO = 4500000001

/** SAP simulado sobre archivos: out/sap/ordenes.jsonl (una OC por línea). */
export class MockSapAdapter implements SapAdapter {
  private root: string
  constructor(root: string) {
    this.root = root
  }

  private get archivo(): string {
    return join(this.root, "out", "sap", "ordenes.jsonl")
  }

  private async registros(): Promise<Registro[]> {
    const t = await leerTextoOpcional(this.archivo)
    if (!t) return []
    return t.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Registro)
  }

  async consultarProveedor(nit: string) {
    const m = await cargarMaestros(this.root)
    const p = m.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit))
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async crearOrden(orden: OrdenCompra) {
    const existentes = await this.registros()
    const numero_oc = String(PRIMER_NUMERO + existentes.length)
    const fecha = new Date().toISOString().slice(0, 10)
    await mkdir(join(this.root, "out", "sap"), { recursive: true })
    await appendFile(this.archivo, JSON.stringify({ numero_oc, fecha, orden }) + "\n", "utf8")
    return { numero_oc, fecha }
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = (await this.registros()).find((x) => x.orden.referencia.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null
  }
}
