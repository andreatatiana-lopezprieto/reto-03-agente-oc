import { readFile } from "node:fs/promises"

export type Fallo = { ok: false; error: string; requiere_confirmacion?: boolean; detalle?: unknown }
export type Resultado<T> = { ok: true; data: T } | Fallo

export const ok = <T>(data: T): Resultado<T> => ({ ok: true, data })
export const fallo = (error: string, extra: Partial<Fallo> = {}): Fallo => ({ ok: false, error, ...extra })

/** "900.555.111-2" -> "900555111" (sin puntos ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  const base = nit.includes("-") ? (nit.split("-")[0] ?? "") : nit
  return base.replace(/\D/g, "")
}

export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** "COP 11.400.000" -> 11400000 */
export function aNumero(texto: string): number {
  return Number(texto.replace(/[.,\s]/g, ""))
}

/** JSON con llaves ordenadas, para comparar objetos sin depender del orden. */
export function canon(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canon).join(",")}]`
  if (valor && typeof valor === "object") {
    const o = valor as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(valor)
}

/** Lee un archivo de texto; null si no existe. */
export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null
    throw e
  }
}

export const CASO_VALIDO = /^[A-Za-z0-9_-]+$/
export const dinero = (n: number) => `$${n.toLocaleString("es-CO")}`
