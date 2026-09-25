import type { DemoProduct, DemoSupplier } from './spec';

/**
 * Proveedores y productos de la taberna de demostración.
 * Precios de referencia: mercado mayorista español 2025–2026, sin IVA (los precios vigentes salen de las facturas).
 * IVA de compra según la Ley 37/1992: 4 % (pan común, harinas, leche, quesos, huevos, frutas, verduras, cereales,
 * aceite de oliva), 10 % (resto de alimentos y agua) y 21 % (bebidas alcohólicas y refrescos azucarados).
 */

export const DEMO_SUPPLIERS: DemoSupplier[] = [
  {
    key: 'garcia',
    name: 'Frutas y Verduras Hermanos García S.L.',
    taxId: 'B28415735',
    notes: 'Reparto lunes, miércoles y viernes antes de las 10:00. Pedido por WhatsApp hasta las 20:00 del día anterior.',
  },
  {
    key: 'guadarrama',
    name: 'Carnes Selectas Guadarrama S.L.',
    taxId: 'B86532413',
    notes: 'Ternera nacional y porcino ibérico. Maduración en cámara propia. Pago a 30 días.',
  },
  {
    key: 'cantabrico',
    name: 'Pescados y Mariscos del Cantábrico S.A.',
    taxId: 'A39061288',
    notes: 'Lonja diaria de martes a sábado. Congelados en caja con peso neto escurrido.',
  },
  {
    key: 'centro',
    name: 'Distribuciones Hosteleras Centro S.L.',
    taxId: 'B87214656',
    notes: 'Cash & carry: aceites, harinas, lácteos, secos y congelados. Rappel del 2 % trimestral.',
  },
  {
    key: 'sierra',
    name: 'Bebidas y Vinos Sierra S.L.',
    taxId: 'B78903168',
    notes: 'Cerveza de barril, aguas y vinos. Recogida de envases retornables en cada entrega.',
  },
];

export const DEMO_PRODUCTS: DemoProduct[] = [
  // ── Frutas y verduras (Hermanos García) ──
  { key: 'patata', name: 'Patata agria', category: 'verdura', baseUnit: 'kg', wastePct: 18, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Patata para freír'] },
  { key: 'cebolla', name: 'Cebolla blanca', category: 'verdura', baseUnit: 'kg', wastePct: 10, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'ajo', name: 'Ajo morado', category: 'verdura', baseUnit: 'kg', wastePct: 15, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Ajo'] },
  { key: 'tomate_pera', name: 'Tomate pera', category: 'verdura', baseUnit: 'kg', wastePct: 8, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'tomate_rosa', name: 'Tomate rosa', category: 'verdura', baseUnit: 'kg', wastePct: 6, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Tomate rosa de Barbastro'] },
  { key: 'pimiento_verde', name: 'Pimiento verde italiano', category: 'verdura', baseUnit: 'kg', wastePct: 15, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'padron', name: 'Pimiento de Padrón', category: 'verdura', baseUnit: 'kg', wastePct: 5, cookingLossPct: 10, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'calabacin', name: 'Calabacín', category: 'verdura', baseUnit: 'kg', wastePct: 5, cookingLossPct: 10, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'zanahoria', name: 'Zanahoria', category: 'verdura', baseUnit: 'kg', wastePct: 12, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'puerro', name: 'Puerro', category: 'verdura', baseUnit: 'kg', wastePct: 35, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'apio', name: 'Apio', category: 'verdura', baseUnit: 'kg', wastePct: 20, cookingLossPct: 0, allergens: ['apio'], supplier: 'garcia', vatPct: 4 },
  { key: 'perejil', name: 'Perejil fresco', category: 'verdura', baseUnit: 'ud', wastePct: 35, cookingLossPct: 0, unitWeightKg: 0.1, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Perejil'], notes: 'Manojo de unos 100 g.' },
  { key: 'albahaca', name: 'Albahaca fresca', category: 'verdura', baseUnit: 'ud', wastePct: 40, cookingLossPct: 0, unitWeightKg: 0.04, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Albahaca'], notes: 'Manojo de unos 40 g.' },
  { key: 'rucula', name: 'Rúcula', category: 'verdura', baseUnit: 'kg', wastePct: 5, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },
  { key: 'cebolleta', name: 'Cebolleta tierna', category: 'verdura', baseUnit: 'kg', wastePct: 25, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Cebolleta'] },
  { key: 'limon', name: 'Limón', category: 'fruta', baseUnit: 'kg', wastePct: 50, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4, notes: 'Merma pensada para uso en zumo (rendimiento ≈ 50 %).' },
  { key: 'aguacate', name: 'Aguacate Hass', category: 'fruta', baseUnit: 'kg', wastePct: 32, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4, aliases: ['Aguacate'] },
  { key: 'frambuesa', name: 'Frambuesa', category: 'fruta', baseUnit: 'kg', wastePct: 3, cookingLossPct: 0, allergens: [], supplier: 'garcia', vatPct: 4 },

  // ── Carnes y charcutería (Carnes Selectas Guadarrama) ──
  { key: 'solomillo', name: 'Solomillo de ternera entero', category: 'carne', baseUnit: 'kg', wastePct: 20, cookingLossPct: 22, allergens: [], supplier: 'guadarrama', vatPct: 10, aliases: ['Solomillo de ternera', 'Solomillo'], notes: 'Pieza entera con cordón. Coste real según la prueba de rendimiento.' },
  { key: 'chuleton', name: 'Lomo alto de vaca madurada', category: 'carne', baseUnit: 'kg', wastePct: 8, cookingLossPct: 18, allergens: [], supplier: 'guadarrama', vatPct: 10, aliases: ['Chuletón de vaca', 'Chuletón'], notes: 'Maduración de 45 días. Se corta en chuletones de 1 kg con hueso.' },
  { key: 'secreto', name: 'Secreto ibérico', category: 'carne', baseUnit: 'kg', wastePct: 5, cookingLossPct: 25, allergens: [], supplier: 'guadarrama', vatPct: 10 },
  { key: 'carrillera', name: 'Carrillera de cerdo ibérico', category: 'carne', baseUnit: 'kg', wastePct: 10, cookingLossPct: 35, allergens: [], supplier: 'guadarrama', vatPct: 10, aliases: ['Carrillera ibérica', 'Carrilleras'] },
  { key: 'jamon', name: 'Jamón ibérico de bellota 50 % raza ibérica', category: 'charcuteria', baseUnit: 'kg', wastePct: 48, cookingLossPct: 0, allergens: [], supplier: 'guadarrama', vatPct: 10, aliases: ['Jamón ibérico de bellota', 'Jamón ibérico'], notes: 'Pieza de 7,5–8 kg. Rendimiento medio al corte: 52 % (hueso, corteza y grasa exterior).' },
  { key: 'taquitos', name: 'Taquitos de jamón ibérico', category: 'charcuteria', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'guadarrama', vatPct: 10, aliases: ['Tacos de jamón ibérico'] },
  { key: 'huesos', name: 'Huesos de ternera', category: 'carne', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'guadarrama', vatPct: 10, aliases: ['Hueso de caña de ternera', 'Huesos para fondo'] },

  // ── Pescados y mariscos (Cantábrico) ──
  { key: 'pulpo', name: 'Pulpo crudo congelado', category: 'marisco', baseUnit: 'kg', wastePct: 12, cookingLossPct: 45, allergens: ['moluscos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Pulpo'], notes: 'Calibre T3 (1–2 kg). Coste real según la prueba de rendimiento.' },
  { key: 'gamba_roja', name: 'Gamba roja congelada', category: 'marisco', baseUnit: 'kg', wastePct: 50, cookingLossPct: 10, allergens: ['crustaceos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Gamba roja'], notes: 'Calibre 2 (≈ 30 piezas/kg). Merma pensada para uso pelada.' },
  { key: 'gamba_pelada', name: 'Gamba blanca pelada congelada', category: 'marisco', baseUnit: 'kg', wastePct: 10, cookingLossPct: 20, allergens: ['crustaceos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Gamba pelada', 'Gamba blanca'], notes: 'Merma = glaseado de congelación.' },
  { key: 'mejillon', name: 'Mejillón de roca', category: 'marisco', baseUnit: 'kg', wastePct: 5, cookingLossPct: 20, allergens: ['moluscos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Mejillón'] },
  { key: 'almeja', name: 'Almeja japónica', category: 'marisco', baseUnit: 'kg', wastePct: 3, cookingLossPct: 10, allergens: ['moluscos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Almeja', 'Almejas'] },
  { key: 'calamar', name: 'Calamar limpio congelado', category: 'marisco', baseUnit: 'kg', wastePct: 3, cookingLossPct: 35, allergens: ['moluscos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Calamar'] },
  { key: 'sepia', name: 'Sepia limpia congelada', category: 'marisco', baseUnit: 'kg', wastePct: 5, cookingLossPct: 30, allergens: ['moluscos'], supplier: 'cantabrico', vatPct: 10, aliases: ['Sepia'] },
  { key: 'tinta', name: 'Tinta de calamar', category: 'conserva', baseUnit: 'ud', wastePct: 0, cookingLossPct: 0, unitWeightKg: 0.004, allergens: ['moluscos'], supplier: 'cantabrico', vatPct: 10, notes: 'Sobre de 4 g.' },
  { key: 'merluza', name: 'Merluza de pincho', category: 'pescado', baseUnit: 'kg', wastePct: 38, cookingLossPct: 12, allergens: ['pescado'], supplier: 'cantabrico', vatPct: 10, aliases: ['Merluza'], notes: 'Pieza entera del Cantábrico: se limpia y se corta en lomos y rodajas en cocina.' },
  { key: 'bacalao', name: 'Lomo de bacalao desalado', category: 'pescado', baseUnit: 'kg', wastePct: 5, cookingLossPct: 12, allergens: ['pescado'], supplier: 'cantabrico', vatPct: 10, aliases: ['Bacalao desalado', 'Bacalao'] },
  { key: 'salmon', name: 'Salmón noruego entero', category: 'pescado', baseUnit: 'kg', wastePct: 38, cookingLossPct: 18, allergens: ['pescado'], supplier: 'cantabrico', vatPct: 10, aliases: ['Salmón'], notes: 'Pieza fresca de 5–6 kg. Coste real según la prueba de rendimiento.' },
  { key: 'atun_rojo', name: 'Lomo de atún rojo', category: 'pescado', baseUnit: 'kg', wastePct: 8, cookingLossPct: 0, allergens: ['pescado'], supplier: 'cantabrico', vatPct: 10, aliases: ['Atún rojo de almadraba', 'Atún rojo'], notes: 'Ultracongelado a −60 °C, apto para consumo en crudo.' },
  { key: 'morralla', name: 'Pescado de roca para fumet', category: 'pescado', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['pescado'], supplier: 'cantabrico', vatPct: 10, aliases: ['Morralla', 'Pescado de roca'] },

  // ── Cash & carry (Distribuciones Hosteleras Centro) ──
  { key: 'aove', name: 'Aceite de oliva virgen extra', category: 'aceite', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 0.916, allergens: [], supplier: 'centro', vatPct: 4, aliases: ['AOVE', 'Aceite de oliva'] },
  { key: 'girasol', name: 'Aceite de girasol alto oleico', category: 'aceite', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 0.92, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Aceite de girasol', 'Aceite para freír'] },
  { key: 'harina', name: 'Harina de trigo', category: 'cereal', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['gluten'], supplier: 'centro', vatPct: 4, aliases: ['Harina'] },
  { key: 'pan_rallado', name: 'Pan rallado', category: 'panaderia', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['gluten'], supplier: 'centro', vatPct: 10 },
  { key: 'leche', name: 'Leche entera', category: 'lacteo', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 1.03, allergens: ['lacteos'], supplier: 'centro', vatPct: 4, aliases: ['Leche'] },
  { key: 'nata', name: 'Nata para montar 35 % MG', category: 'lacteo', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 1.0, allergens: ['lacteos'], supplier: 'centro', vatPct: 10, aliases: ['Nata', 'Nata 35 %'] },
  { key: 'mantequilla', name: 'Mantequilla', category: 'lacteo', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['lacteos'], supplier: 'centro', vatPct: 10 },
  { key: 'huevos', name: 'Huevos camperos L', category: 'huevo', baseUnit: 'ud', wastePct: 12, cookingLossPct: 0, unitWeightKg: 0.063, allergens: ['huevo'], supplier: 'centro', vatPct: 4, aliases: ['Huevo', 'Huevos'], notes: 'Categoría A, talla L (63–73 g). Merma = cáscara.' },
  { key: 'queso_crema', name: 'Queso crema', category: 'lacteo', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['lacteos'], supplier: 'centro', vatPct: 4, aliases: ['Queso crema para untar'] },
  { key: 'queso_azul', name: 'Queso azul de Valdeón', category: 'lacteo', baseUnit: 'kg', wastePct: 5, cookingLossPct: 0, allergens: ['lacteos'], supplier: 'centro', vatPct: 4, aliases: ['Queso azul'] },
  { key: 'burrata', name: 'Burrata fresca 125 g', category: 'lacteo', baseUnit: 'ud', wastePct: 0, cookingLossPct: 0, unitWeightKg: 0.125, allergens: ['lacteos'], supplier: 'centro', vatPct: 4, aliases: ['Burrata'] },
  { key: 'azucar', name: 'Azúcar blanco', category: 'dulce', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Azúcar'] },
  { key: 'sal', name: 'Sal fina', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Sal'] },
  { key: 'sal_escamas', name: 'Sal en escamas', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Sal Maldon', 'Escamas de sal'] },
  { key: 'pimienta', name: 'Pimienta negra molida', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Pimienta negra', 'Pimienta'] },
  { key: 'pimenton_dulce', name: 'Pimentón de la Vera dulce', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Pimentón dulce'] },
  { key: 'pimenton_picante', name: 'Pimentón de la Vera picante', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Pimentón picante'] },
  { key: 'cayena', name: 'Guindilla cayena', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Cayena', 'Guindilla seca'] },
  { key: 'nuez_moscada', name: 'Nuez moscada molida', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Nuez moscada'] },
  { key: 'laurel', name: 'Laurel en hoja', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Laurel'] },
  { key: 'canela', name: 'Canela molida', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Canela'] },
  { key: 'azafran', name: 'Azafrán en hebra', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Azafrán'], notes: 'D.O.P. Azafrán de La Mancha, sobres de 1 g.' },
  { key: 'arroz', name: 'Arroz bomba', category: 'cereal', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 4, aliases: ['Arroz'] },
  { key: 'chocolate', name: 'Chocolate de cobertura negro 70 %', category: 'dulce', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['soja'], supplier: 'centro', vatPct: 10, aliases: ['Chocolate negro', 'Cobertura 70 %'] },
  { key: 'brioche', name: 'Pan brioche para torrijas', category: 'panaderia', baseUnit: 'ud', wastePct: 4, cookingLossPct: 0, unitWeightKg: 0.5, allergens: ['gluten', 'huevo', 'lacteos'], supplier: 'centro', vatPct: 10, aliases: ['Pan brioche', 'Brioche'], notes: 'Barra de 500 g; se cortan 8 torrijas (la merma son las puntas).' },
  { key: 'picos', name: 'Picos de pan artesanos', category: 'panaderia', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['gluten'], supplier: 'centro', vatPct: 10, aliases: ['Picos', 'Regañás'] },
  { key: 'mayonesa', name: 'Mayonesa', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['huevo', 'mostaza'], supplier: 'centro', vatPct: 10 },
  { key: 'atun_lata', name: 'Atún claro en aceite de oliva', category: 'conserva', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['pescado'], supplier: 'centro', vatPct: 10, aliases: ['Atún en aceite', 'Atún claro'] },
  { key: 'ventresca', name: 'Ventresca de bonito del norte', category: 'conserva', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['pescado'], supplier: 'centro', vatPct: 10, aliases: ['Ventresca'] },
  { key: 'aceitunas', name: 'Aceituna manzanilla sin hueso', category: 'conserva', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Aceitunas'] },
  { key: 'guisantes', name: 'Guisante fino congelado', category: 'congelado', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 4, aliases: ['Guisantes'] },
  { key: 'tomate_triturado', name: 'Tomate triturado natural', category: 'conserva', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [], supplier: 'centro', vatPct: 10, aliases: ['Tomate triturado'] },
  { key: 'soja', name: 'Salsa de soja', category: 'condimento', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 1.15, allergens: ['soja', 'gluten'], supplier: 'centro', vatPct: 10, aliases: ['Soja'] },
  { key: 'sesamo', name: 'Sésamo tostado', category: 'condimento', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: ['sesamo'], supplier: 'centro', vatPct: 10, aliases: ['Sésamo'] },
  { key: 'vinagre_jerez', name: 'Vinagre de Jerez', category: 'condimento', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 1.01, allergens: ['sulfitos'], supplier: 'centro', vatPct: 10 },
  { key: 'helado_vainilla', name: 'Helado de vainilla', category: 'congelado', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 0.55, allergens: ['lacteos', 'huevo'], supplier: 'centro', vatPct: 10, notes: 'Cubeta de 5 l. Bola de servicio ≈ 60 ml.' },

  // ── Bebidas (Bebidas y Vinos Sierra) ──
  { key: 'vino_tinto', name: 'Vino tinto joven', category: 'bebida', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 0.99, allergens: ['sulfitos'], supplier: 'sierra', vatPct: 21, aliases: ['Vino tinto', 'Vino tinto para cocinar'] },
  { key: 'vino_blanco', name: 'Vino blanco airén', category: 'bebida', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 0.99, allergens: ['sulfitos'], supplier: 'sierra', vatPct: 21, aliases: ['Vino blanco', 'Vino blanco para cocinar'] },
  { key: 'cerveza', name: 'Cerveza lager de barril', category: 'bebida', baseUnit: 'l', wastePct: 0, cookingLossPct: 0, densityKgPerL: 1.01, allergens: ['gluten'], supplier: 'sierra', vatPct: 21, aliases: ['Cerveza de barril', 'Caña'] },
  { key: 'agua', name: 'Agua mineral 50 cl', category: 'bebida', baseUnit: 'ud', wastePct: 0, cookingLossPct: 0, unitWeightKg: 0.5, densityKgPerL: 1, allergens: [], supplier: 'sierra', vatPct: 10, aliases: ['Agua mineral', 'Agua'] },
  { key: 'refresco_cola', name: 'Refresco de cola 33 cl', category: 'bebida', baseUnit: 'ud', wastePct: 0, cookingLossPct: 0, unitWeightKg: 0.33, densityKgPerL: 1.04, allergens: [], supplier: 'sierra', vatPct: 21, aliases: ['Refresco de cola', 'Cola'] },
  { key: 'rioja', name: 'Vino tinto D.O.Ca. Rioja crianza 75 cl', category: 'bebida', baseUnit: 'ud', wastePct: 0, cookingLossPct: 0, unitWeightKg: 0.75, densityKgPerL: 0.99, allergens: ['sulfitos'], supplier: 'sierra', vatPct: 21, aliases: ['Rioja crianza'] },
  { key: 'verdejo', name: 'Vino blanco D.O. Rueda verdejo 75 cl', category: 'bebida', baseUnit: 'ud', wastePct: 0, cookingLossPct: 0, unitWeightKg: 0.75, densityKgPerL: 0.99, allergens: ['sulfitos'], supplier: 'sierra', vatPct: 21, aliases: ['Verdejo', 'Rueda verdejo'] },
];
