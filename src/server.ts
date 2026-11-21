import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { nuevaSesion, procesarTurno, type ConfigAgente, type Sesion } from "./agente.ts"
import { crearLlm } from "./llm/index.ts"

const directorio = fileURLToPath(new URL("..", import.meta.url))
const env = process.env
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d)

const llm = crearLlm(env)
const MAX_SESIONES = 200
const LIMITE = { ventanaMs: 5 * 60_000, max: num(env.RATE_LIMIT, 30) }
const sesiones = new Map<string, Sesion>()
const golpes = new Map<string, number[]>()

async function cargarSistema(): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(`${directorio}agent/prompt.md`, "utf8"),
    readFile(`${directorio}src/knowledge/ordenes-compra.md`, "utf8"),
  ])
  return `${prompt}\n\n---\n# Conocimiento del proceso\n${conocimiento}`
}
const sistema = await cargarSistema()
const cfg: ConfigAgente = { sistema, directorio, maxIteraciones: num(env.MAX_ITERACIONES, 25), maxTokensSesion: num(env.MAX_TOKENS_SESION, 60_000) }

const ChatSchema = z.object({ sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), message: z.string().trim().min(1).max(2000) })

function json(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(cuerpo))
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const t of req) {
    total += (t as Buffer).length
    if (total > 20_000) throw new Error("Cuerpo demasiado grande")
    trozos.push(t as Buffer)
  }
  return JSON.parse(Buffer.concat(trozos).toString("utf8") || "{}")
}

function limitado(ip: string): boolean {
  const ahora = Date.now()
  const recientes = (golpes.get(ip) ?? []).filter((t) => ahora - t < LIMITE.ventanaMs)
  recientes.push(ahora)
  golpes.set(ip, recientes)
  return recientes.length > LIMITE.max
}

async function chat(req: IncomingMessage, res: ServerResponse) {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0]?.trim() ?? "?"
  if (limitado(ip)) return json(res, 429, { error: "Demasiadas solicitudes. Espera unos minutos e intenta de nuevo." })
  let entrada: z.infer<typeof ChatSchema>
  try { entrada = ChatSchema.parse(await leerCuerpo(req)) } catch { return json(res, 400, { error: "Solicitud inválida: se espera { sessionId, message } con mensaje de hasta 2000 caracteres." }) }
  if (!llm) return json(res, 200, { reply: "⚠️ El agente no tiene un modelo configurado todavía (falta LLM_API_KEY en el servidor).", toolCalls: [], needsConfirmation: false })
  let s = sesiones.get(entrada.sessionId)
  if (!s) {
    if (sesiones.size >= MAX_SESIONES) sesiones.delete(sesiones.keys().next().value as string)
    s = nuevaSesion(entrada.sessionId, cfg.sistema)
    sesiones.set(s.id, s)
  }
  if (s.ocupada) return json(res, 409, { error: "El agente sigue procesando tu mensaje anterior." })
  s.ocupada = true
  try { json(res, 200, await procesarTurno(s, entrada.message, llm, cfg)) } finally { s.ocupada = false }
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, provider: llm?.proveedor ?? "none", model: llm?.modelo ?? null })
    if (req.method === "POST" && url.pathname === "/api/chat") return await chat(req, res)
    const m = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]{8,64})$/)
    if (req.method === "GET" && m?.[1]) {
      const s = sesiones.get(m[1])
      return s ? json(res, 200, { sessionId: s.id, historial: s.historial }) : json(res, 404, { error: "Sesión no encontrada" })
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" })
      return res.end(await readFile(`${directorio}web/index.html`))
    }
    json(res, 404, { error: "No encontrado" })
  } catch (e) {
    json(res, 500, { error: "Error interno del servidor" })
    console.error("[error]", e instanceof Error ? e.message : e)
  }
})

const puerto = num(env.PORT, 3000)
servidor.listen(puerto, () => console.log(`Agente OC escuchando en http://localhost:${puerto} (proveedor: ${llm?.proveedor ?? "sin configurar"})`))
