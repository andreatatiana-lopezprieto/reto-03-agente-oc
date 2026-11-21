import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { fallo } from "../core/util.ts"
import type { Ctx } from "../types.ts"
import * as oc from "./oc.ts"

type Definicion<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<string>
}

/** Valida argumentos con zod ANTES de ejecutar y devuelve el error al modelo si no cumplen. */
function definir<S extends z.ZodRawShape>(nombre: string, h: Definicion<S>) {
  const esquema = z.object(h.args)
  return {
    nombre,
    description: h.description,
    args: h.args,
    async ejecutar(crudos: unknown, ctx: Ctx): Promise<string> {
      const r = esquema.safeParse(crudos)
      const salida = r.success
        ? await h.execute(r.data, ctx)
        : JSON.stringify(fallo(`Argumentos inválidos para ${nombre}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`))
      await registrarLlamada(ctx, nombre, crudos, salida)
      return salida
    },
  }
}

/** CA4: toda llamada queda en out/log.jsonl (nunca se registran claves: las herramientas no las reciben). */
async function registrarLlamada(ctx: Ctx, tool: string, args: unknown, salida: string) {
  try {
    await mkdir(join(ctx.directory, "out"), { recursive: true })
    const resumen = salida.length > 2000 ? salida.slice(0, 2000) + "…" : salida
    await appendFile(join(ctx.directory, "out", "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), sessionId: ctx.sessionId, tool, args, resultado: resumen }) + "\n", "utf8")
  } catch {
    /* el log no debe romper la herramienta */
  }
}

/** El nombre que ve el modelo es <archivo>_<export>. */
export const herramientas = {
  oc_leer_paquete: definir("oc_leer_paquete", oc.leer_paquete),
  oc_validar: definir("oc_validar", oc.validar),
  oc_construir_payload: definir("oc_construir_payload", oc.construir_payload),
  oc_generar_evidencia: definir("oc_generar_evidencia", oc.generar_evidencia),
  oc_crear: definir("oc_crear", oc.crear),
}

export type NombreHerramienta = keyof typeof herramientas

export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: Ctx): Promise<string> {
  const h = (herramientas as Record<string, { ejecutar: (a: unknown, c: Ctx) => Promise<string> } | undefined>)[nombre]
  if (!h) return JSON.stringify(fallo(`Herramienta desconocida: ${nombre}`))
  return h.ejecutar(args, ctx)
}
