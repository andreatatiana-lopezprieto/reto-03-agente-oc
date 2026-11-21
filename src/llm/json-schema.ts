import type { z } from "zod"

type Def = {
  typeName?: string
  innerType?: z.ZodTypeAny
  type?: z.ZodTypeAny
  valueType?: z.ZodTypeAny
  values?: string[]
  value?: unknown
  shape?: () => Record<string, z.ZodTypeAny>
}
export type JsonSchema = Record<string, unknown>

/** Conversor mínimo zod → JSON Schema para los tipos que usan nuestras herramientas. */
export function aJsonSchema(s: z.ZodTypeAny): JsonSchema {
  const def = s._def as Def
  let out: JsonSchema = {}
  switch (def.typeName) {
    case "ZodString": out = { type: "string" }; break
    case "ZodNumber": out = { type: "number" }; break
    case "ZodBoolean": out = { type: "boolean" }; break
    case "ZodLiteral": out = { const: def.value, type: typeof def.value }; break
    case "ZodEnum": out = { type: "string", enum: def.values }; break
    case "ZodArray": out = { type: "array", items: def.type ? aJsonSchema(def.type) : {} }; break
    case "ZodRecord": out = { type: "object", additionalProperties: def.valueType ? aJsonSchema(def.valueType) : {} }; break
    case "ZodOptional": out = def.innerType ? aJsonSchema(def.innerType) : {}; break
    case "ZodNullable": out = { anyOf: [def.innerType ? aJsonSchema(def.innerType) : {}, { type: "null" }] }; break
    case "ZodObject": {
      const shape = def.shape?.() ?? {}
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = aJsonSchema(v)
        if (!v.isOptional()) required.push(k)
      }
      out = { type: "object", properties, ...(required.length ? { required } : {}) }
      break
    }
    default: out = {}
  }
  if (s.description) out.description = s.description
  return out
}
