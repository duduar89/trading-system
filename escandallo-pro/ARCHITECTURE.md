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
    invoiceParser.ts  Parser heurístico de facturas (validación cruzada cantidad×precio=importe)
    menuParser.ts     Parser heurístico de cartas
    spreadsheet.ts    Excel/CSV de facturas o tarifas
    layout.ts         Reconstrucción de filas/columnas a partir de posiciones (pdf.js)
    imageOps.ts       Preprocesado de fotos: papel/perspectiva, iluminación, contraste, enderezado, binarización
    prep.worker.ts    Preprocesado en un Web Worker (no bloquea la interfaz)
    ocrPipeline.ts    OCR en varias pasadas (tabla / bloque / binarizado) hasta que las cuentas cuadran
    ocrLayout.ts      Filas de tabla y columnas de carta a partir de las cajas de palabras del OCR
    ocrFixes.ts       Correcciones de OCR validadas (O↔0, S↔5, «G» leída como «6», palabras pegadas…)
    menuUtils.ts      Ayudas del parser de cartas (precios, secciones, ruido)
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
La lectura de facturas y cartas funciona 100 % en el dispositivo y sin coste: capa de texto de pdf.js con
reconstrucción de columnas, OCR con tesseract.js (modelo español más preciso) tras un preprocesado de imagen,
y validación aritmética (cantidad × precio × (1 − dto) = importe; suma de líneas = base imponible) que decide entre
lecturas alternativas y corrige errores típicos del OCR solo cuando las cuentas lo demuestran.

Benchmark (`node scripts/bench-extraction.mjs` y `node scripts/bench-menu.mjs`) sobre `public/samples` y variantes
degradadas generadas (foto girada, perspectiva, sombra fuerte, baja resolución, PDF escaneado, fax con ruido):
PDF con texto 100 % de líneas exactas, fotos y escaneos 100 %, cartas 100 % (cabeceras 100 %).

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
