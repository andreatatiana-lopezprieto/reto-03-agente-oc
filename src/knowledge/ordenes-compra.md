# Proceso de órdenes de compra (OC) — conocimiento de referencia

## Qué es el flujo
Cada compra llega a administración por correo con: solicitud (Excel), cotización del proveedor y correo de aprobación del líder. La analista crea la OC en SAP (proveedor, descripción, centro de costo y subárea, valor, indicador de IVA, aprobador, condiciones de pago) y adjunta el correo de aprobación como evidencia.

## Controles (RC1–RC10)
| Código | Regla | Efecto |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo | Bloqueo |
| RC2 | Hay aprobación, contiene «Aprobado» y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización vs solicitud: diferencia ≤ 2 %; sin cotización también pide confirmación | Confirmación |
| RC6 | Sin indicador de IVA: se deriva del proveedor | Confirmación + derivado |
| RC7 | Sin condiciones de pago: se derivan del proveedor | Derivado (informativo) |
| RC8 | Factura anterior a la solicitud: compra retroactiva | Confirmación + marca en control |
| RC9 | Aprobación con fecha anterior a la solicitud | Confirmación |
| RC10 | cantidad × valor unitario = valor total (±1) | Bloqueo |
| RC11 | NIT de la cotización distinto al del maestro (control adicional) | Confirmación |

## Tipos de resultado
- **Bloqueo**: no se crea la OC; se devuelve al solicitante con la acción sugerida.
- **Confirmación**: se crea solo si la analista confirma de forma explícita.
- **Derivado**: valor completado desde maestros; se informa.

## Compras retroactivas
Ocurren cuando la OC se crea después de recibir la factura, saltándose la cotización. El agente no las rechaza: las marca (`retroactiva = true` en `out/control.csv`) para que la dirección pueda medirlas.

## Códigos útiles
- Indicadores de IVA: C0 excluido/no gravado, C1 IVA 19 %, C2 IVA 5 %.
- Condiciones de pago: Z000 inmediato, Z015 15 días, Z030 30 días, Z060 60 días.
- Sociedad y organización de compras: 1000. Posiciones numeradas 10, 20, 30… Descripción máxima de 40 caracteres.
- Números de OC del SAP simulado: secuencia desde 4500000001.

## Salidas del sistema
`out/sap/ordenes.jsonl` (OC creadas), `out/control.csv` (log de control para Contabilidad/Auditoría), `out/log.jsonl` (llamadas a herramientas), `out/<caso>/aprobacion.txt` (evidencia con sha256) y `out/<caso>/trazabilidad.json` (origen de cada valor).
