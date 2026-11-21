import type { OrdenCompra } from "../types.ts"

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  // `fecha` es opcional: permite devolver la fecha original en reintentos idempotentes.
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha?: string } | null>
}
