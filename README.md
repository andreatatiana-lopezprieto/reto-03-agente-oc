# reto-03-agente-oc

Agente conversacional que lee solicitudes de compra, las valida contra los maestros (RC1–RC10), construye el payload de la OC, genera la evidencia de aprobación y crea la OC en un SAP simulado. Prueba técnica · Periferia IT Group.

**Link de prueba:** _(pendiente: URL pública del despliegue)_

## Levantar en local (un comando)

```bash
bun install
cp .env.example .env     # completa LLM_API_KEY (y LLM_PROVIDER / LLM_MODEL si quieres)
bun run dev              # http://localhost:3000
```

Con Node 22+: `npm install && npm run start:node`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `LLM_PROVIDER` | `anthropic` (por defecto) u `openai` |
| `LLM_MODEL` | Modelo a usar (hay un valor por defecto por proveedor) |
| `LLM_API_KEY` | Clave del proveedor. Solo vive en el servidor; nunca en el repo, el front ni los logs |
| `LLM_BASE_URL` | Opcional, para APIs compatibles con OpenAI |
| `MAX_ITERACIONES` | Tope de pasos herramienta→modelo por turno (25) |
| `MAX_TOKENS_SESION` | Tope de tokens por sesión (60000) |
| `RATE_LIMIT` | Mensajes por IP cada 5 minutos (30) |
| `PORT` | Puerto (3000) |

## Verificación sin modelo

```bash
bun run demo.ts            # procesa los 6 casos llamando a las herramientas directamente
bun run verificar-agente.ts  # prueba el ciclo del agente con un LLM simulado
```

`demo.ts` no necesita ninguna clave. Limpia `out/` al inicio y muestra la idempotencia (sol-001 dos veces) y la confirmación explícita de sol-004.

## API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| GET | `/api/sessions/:id` | Historial completo de la sesión |
| GET | `/api/health` | `{ ok, provider, model }` (sin claves) |

## Estructura

- `agent/prompt.md`: comportamiento del agente (system prompt).
- `src/knowledge/ordenes-compra.md`: conocimiento del proceso (se adjunta al prompt).
- `src/tools/oc.ts`: herramientas tipadas con zod; la lógica vive en `src/core/`.
- `src/sap/`: interfaz `SapAdapter` y simulación sobre archivos.
- `src/llm/`: adaptador de proveedor (Anthropic y OpenAI).
- `src/agente.ts` y `src/server.ts`: ciclo del agente y API HTTP.
- `web/index.html`: chat.
- `out/`: generado en ejecución (`sap/ordenes.jsonl`, `control.csv`, `log.jsonl`, evidencias).

## Despliegue

Incluye `Dockerfile` (Bun). En Render o Railway: crear un servicio web desde este repo y definir `LLM_API_KEY` como variable secreta.
