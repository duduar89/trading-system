# Escandallo Pro · Food cost inteligente para hostelería

**Sube tus facturas, haz una foto a la carta y obtén el escandallo, el food cost y la merma de cada plato en minutos.**

Escandallo Pro es una aplicación web progresiva (PWA) pensada para restaurantes, bares, grupos de restauración y
agencias/consultoras que dan servicio a hostelería. Funciona en el móvil, la tablet y el ordenador, se instala como
una app y trabaja **sin conexión**: los datos se guardan en el propio dispositivo.

## Qué hace

| Paso | Qué ocurre |
| --- | --- |
| **1. Facturas** | Arrastra facturas en PDF, fotos o un Excel/CSV con tu listado de compras. La app lee proveedor, fecha, líneas, cantidades, formatos («caja 6×1 l», «saco 25 kg»), descuentos e IVA, valida cada línea (cantidad × precio = importe) y calcula el **precio real por kg, litro o unidad**. |
| **2. Base de ingredientes** | Cada línea se coteja automáticamente con tus ingredientes (emparejamiento difuso tolerante a abreviaturas de proveedor, plurales y marcas). Se guarda el histórico de precios y se generan **alertas de subida**. |
| **3. Foto de la carta** | Fotografía la carta (una o varias páginas): se extraen secciones, platos, descripciones y PVP. |
| **4. Propuesta de escandallo** | Para cada plato se proponen los ingredientes con gramajes profesionales por ración (IA de Claude o recetario local de +170 recetas tipo) y se **cotejan con los productos de tus facturas**. Tú revisas y ajustas. |
| **5. Escandallo y food cost** | Coste por ración, food cost %, margen bruto, multiplicador, **PVP sugerido** para tu objetivo, alérgenos automáticos (14 del Reglamento UE 1169/2011) y ficha técnica imprimible. |
| **6. Mermas** | Merma de limpieza y de cocción por ingrediente, **merma total y merma por plato** (en gramos y en euros) y **pruebas de rendimiento por pieza** (despiece): rendimiento real, coste por kg aprovechable descontando subproductos, raciones por pieza y merma por ración. Vinculada al producto, se aplica sola a todos sus escandallos. |
| **7. Informes** | Panel con KPIs, ingeniería de menú (estrellas, caballos de batalla, enigmas y perros), evolución de precios, análisis de compras y mermas, simulador «¿y si sube el precio?» y exportación a Excel. |

Y además: **multi-restaurante** (ideal para agencias y grupos), elaboraciones/sub-recetas (salsas, fondos, masas),
copias de seguridad, tema claro/oscuro y datos de ejemplo para probarla en un clic.

## IA opcional (Claude)

Sin configurar nada, la app usa lectura de PDF, OCR en español y un recetario local, todo en tu dispositivo.
Para la máxima precisión añade tu clave de API de Anthropic en **Ajustes → Inteligencia artificial**: las facturas,
las cartas y las propuestas de receta se procesan con Claude (Opus 5 por defecto; también Sonnet 5 y Haiku 4.5).
La clave se guarda solo en tu dispositivo y las llamadas van directamente de tu navegador a la API de Anthropic.

## Desarrollo

```bash
cd escandallo-pro
npm install
npm run dev        # servidor de desarrollo
npm test           # tests unitarios (vitest)
npm run build      # build de producción (dist/)
npm run preview    # sirve el build
```

La carpeta `public/samples/` incluye facturas PDF y una foto de carta de ejemplo para probar la lectura.

## Despliegue

Es una app estática: basta con servir `dist/` en cualquier hosting (GitHub Pages, Netlify, Vercel, un servidor
Nginx…). Usa rutas relativas y `HashRouter`, así que funciona en cualquier subruta.

El repositorio incluye `.github/workflows/deploy-escandallo-pro.yml`, que ejecuta los tests, construye la app y la
publica en GitHub Pages al hacer push a `main` (activa **Settings → Pages → Source: GitHub Actions**).

## Arquitectura

Consulta [ARCHITECTURE.md](./ARCHITECTURE.md): stack, mapa de módulos, convenciones y fórmulas de cálculo.
