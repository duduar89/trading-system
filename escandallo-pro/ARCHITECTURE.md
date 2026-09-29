# Escandallo Pro — Arquitectura

PWA 100 % cliente (sin backend). Los datos viven en IndexedDB del dispositivo; la IA (Claude) es opcional
y usa la clave del propio usuario. Todo funciona también sin conexión y sin IA (OCR local + base de recetas).

## Stack
- Vite 8 + React 19 + TypeScript (strict) + Tailwind CSS 4 (tokens en `src/index.css`)
- `react-router` 7 con `HashRouter` (funciona en cualquier hosting estático)
- Dexie 4 + `dexie-react-hooks` (una BD por restaurante/cliente, ver `src/db.ts`)
- `vite-plugin-pwa` (service worker Workbox, manifest, instalación, actualización)
- `pdfjs-dist` (texto de PDF + render a imagen), `tesseract.js` (OCR español), `exceljs` (Excel)
- `@anthropic-ai/sdk` + `zod` (extracción estructurada con Claude), `recharts` (gráficos), `lucide-react` (iconos)
- `vitest` (+ `fake-indexeddb`) para tests; Playwright para pruebas E2E/capturas

## Mapa de módulos
```
src/
  types.ts            Modelo de dominio (contrato central — no romper)
  db.ts               Dexie: metaDb (workspaces, ajustes) + WorkspaceDB por restaurante; backup/restore
  core/               Lógica pura, sin DOM ni BD (100 % testeable)
    units.ts          Conversión de unidades (g, ml, ud, cucharada… ⇄ kg/l/ud)
    yield.ts          Pruebas de rendimiento: merma total, merma real, coste €/kg útil, merma por ración
    costing.ts        Motor de escandallos: bruto/neto/servido, coste, food cost, margen, PVP sugerido, mermas
    numbers.ts        Números y fechas en formato ES
    pack.ts           Formatos de envase ("6x1L", "caja 5 kg") y €/unidad base de líneas de factura
    matching.ts       Emparejamiento difuso de ingredientes ⇄ productos
    analytics.ts      Ingeniería de menú, alertas de precio, KPIs, simulación de precios
  extract/            Lectura de documentos
    pdf.ts ocr.ts     pdf.js y tesseract.js (import dinámico)
    invoiceParser.ts  Parser heurístico de facturas (validación cruzada cantidad×precio=importe); modo cash & carry /
                      mayorista: artículos en dos filas con código de unidad (Prec. Ud. × Cont P. = Precio; Precio × Cant. =
                      Importe), trazabilidad GTIN/Lote, CIF del emisor frente al N.I.F. del cliente, «Total página»
    menuParser.ts     Parser heurístico de cartas
    spreadsheet.ts    Excel/CSV de facturas o tarifas
    layout.ts         Reconstrucción de filas/columnas a partir de posiciones (pdf.js)
    imageOps.ts       Preprocesado de fotos: papel/perspectiva, iluminación, contraste, enderezado, binarización
    prep.worker.ts    Preprocesado en un Web Worker (no bloquea la interfaz)
    ocrPipeline.ts    OCR en varias pasadas (tabla / bloque / binarizado) hasta que las cuentas cuadran
    ocrLayout.ts      Filas de tabla y columnas de carta a partir de las cajas de palabras del OCR; campo de pendientes
                      local para papel curvado (las filas se enlazan renglón a renglón)
    ocrFixes.ts       Correcciones de OCR validadas (O↔0, S↔5, «G» leída como «6», palabras pegadas…)
    menuUtils.ts      Ayudas del parser de cartas (columnas, precios, secciones, ruido de iconos)
    menuImage.ts      Cartas oscuras y pizarras: normalización de polaridad antes del OCR
    tableModel.ts     Modelo de tabla de facturas: columnas tipadas por cabecera y posición (cantidad, kilos, lote…)
    paddleOcr.ts      Adaptador de PaddleOCR (PP-OCRv5): cajas de detección y reconocimiento → palabras/líneas; separa los
                      renglones que la detección une y corta en trozos rectos los curvados (fotos de página completa)
    paddleEngine.ts   Motor PaddleOCR en un worker (paddle.worker.ts) con ONNX Runtime Web; respaldo a Tesseract
    paddleModel.ts    Rutas y huellas de los modelos (public/ocr-models) y del binario de ONNX Runtime
    modelCache.ts     Descarga con verificación (tamaño/SHA-256) y caché propia de modelos para uso sin conexión
    kinds.ts          Utilidades ligeras (tipo de archivo, IA disponible) sin arrastrar los parsers
    index.ts          Orquestador: texto PDF → OCR (IA opcional, desactivada por defecto) con caída automática a local
  ai/                 Claude: client (salida estructurada), invoice, menu, recipes
  kb/                 Base de conocimiento local: ingredientes (mermas, alérgenos, pesos) y recetas tipo
  services/           Casos de uso sobre la BD: products, invoices, dishes, menus, yieldTests, demo
  state/              zustand (toasts, workspace activo) + hooks reactivos de datos (useLiveQuery)
  components/         ui.tsx (librería base), Layout, WorkspaceSwitcher, Toaster, PwaPrompt, Logo…
  pages/              Una página por ruta (lazy)
  lib/                format (es-ES), id, export (Excel/CSV), useOnline
```

## Extracción gratuita y local
La lectura de facturas y cartas funciona 100 % en el dispositivo y sin coste:
- **PDF con texto**: pdf.js (build legacy) → filas y columnas por posición (layout.ts, tableModel.ts) → parser.
- **Fotos**: preprocesado en un worker (papel/perspectiva, iluminación, enderezado, bandas oscuras invertidas, rayas de
  tabla borradas) → **PaddleOCR PP-OCRv5** (detección móvil + reconocedor latino, ONNX Runtime Web) como motor principal
  y **Tesseract** (modelo español best_int) en pasadas de respaldo, combinadas línea a línea por la validación aritmética.
- **PDF escaneados**: render a 300 ppp → Tesseract con varias pasadas.
- **Facturas en varias fotos**: el usuario indica que son páginas de una misma factura (`Invoice.extraPages`) y se leen
  juntas como un documento de varias páginas.
- **Fotos comprimidas** (WhatsApp deja el lado mayor en 1600 px): si la lectura no cuadra, la revisión explica cómo
  conseguir una foto mejor (tamaño leído de la cabecera JPEG/PNG, sin decodificar).
- **Validación aritmética**: cantidad × precio × (1 − dto) = importe y Σ líneas = base imponible deciden entre lecturas
  y autorizan correcciones de OCR (dígitos, decimales perdidos, «G» leída como «6»…).
- Motores (worker y núcleo de Tesseract, binario de ONNX Runtime) y modelos se sirven desde la propia app: el plugin
  `escandallo-ocr-runtime` de vite.config.ts los copia de node_modules al construir (`/ocr-runtime/`), y los modelos
  PP-OCRv5 viven en `public/ocr-models/` (Apache-2.0). Se cachean al primer uso (fuera de la precarga del service worker).

Benchmarks (`npm run bench`, `npm run bench:random`, `node scripts/bench-unseen.mjs`), medidos en semillas reservadas del
generador procedural (nunca inspeccionadas al ajustar): facturas PDF con texto 97,4 % líneas exactas (cabeceras 99,9 %),
fotos y escaneos ~90 %, cartas en foto ~80 % limpia / ~79 % degradada; `public/samples` 100 %. Facturas de mayorista
(`--set=cash-heldout`, semillas 3001–3040): PDF con texto 100 %, fotos ~97 %, escaneos ~82 %.

## Convenciones
- Importes en EUR **sin IVA**, salvo `Dish.menuPrice` (PVP de carta con IVA). Porcentajes 0–100.
- Cantidades internas en unidades base (kg, l, ud). Formatear siempre con `lib/format.ts`.
- La UI se construye con `components/ui.tsx` y los tokens semánticos (`bg-surface`, `text-ink`, `text-muted`,
  `border-line`, `bg-brand-500`, `text-ok|warn|bad|ai`). Nada de grises sueltos (`gray-500`), para que el tema oscuro funcione.
- Textos de la interfaz en español de España, tono profesional y directo ("tú").
- Datos reactivos: hooks de `state/hooks.ts`. Escrituras: funciones de `services/*` (nunca `db()` directamente desde páginas,
  salvo lecturas puntuales).
- Notificaciones: `toast.success/error/info/ai` de `state/store.ts`.
- Todo lo pesado (pdf.js, tesseract, exceljs, SDK de IA) se carga con `import()` dinámico.

## Fórmulas clave (ver `core/costing.ts` y `core/yield.ts`)
- Merma de limpieza `w`, de cocción `k`: bruto = neto / (1−w); servido = neto · (1−k).
- Coste línea = bruto · €/ud base (o neto · coste €/kg útil de la prueba de rendimiento, que descuenta subproductos).
- Food cost = coste ración / (PVP / (1 + IVA)). PVP sugerido = coste / objetivo · (1 + IVA), redondeado hacia arriba.
- Merma por plato = Σ (bruto − servido) por ración, en kg y en € (coste − servido · precio).

## Pruebas
- `npm test`: tests unitarios (vitest + fake-indexeddb) de cálculo, extracción, recetario, servicios y lógica de UI.
- `npm run test:e2e`: construye y ejecuta con Playwright `e2e/smoke.mjs` (todas las pantallas), `offline.mjs` (PWA sin
  conexión), `compras.mjs` (facturas PDF/foto/CSV → precios), `carta.mjs` (foto de carta → escandallos → mermas → ficha),
  `lector-paddle.mjs` (motor OCR) y `perf.mjs` (presupuesto de carga). `e2e/a11y.mjs` pasa axe-core por todas las rutas.
