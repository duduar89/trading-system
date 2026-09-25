import type { KbIngredient } from '../ingredients';
import { ing } from './build';

/**
 * Pescados, mariscos y moluscos. Merma de pescado entero ≈ cabeza, espinas, piel y vísceras para sacar lomos.
 * Mariscos con cáscara: merma según su uso más habitual (pelados para gambas/langostinos, en su concha para bivalvos).
 */
export const KB_MAR: KbIngredient[] = [
  // ── Pescado blanco y azul ──
  ing('Merluza entera', 'pescado', 'kg', 50, 15, 9.5, { aka: ['merluza de pincho', 'merluza fresca entera', 'merluza del cantabrico', 'merluza gallega', 'merluza con cabeza'], alg: ['pescado'] }),
  ing('Lomo de merluza', 'pescado', 'kg', 3, 15, 16, {
    aka: ['merluza', 'lomos de merluza', 'merluza lomo', 'merluza en lomos', 'supremas de merluza', 'rodaja de merluza', 'rodajas de merluza', 'medallon de merluza', 'cogote de merluza', 'merluza limpia'],
    alg: ['pescado'],
  }),
  ing('Pescadilla', 'pescado', 'kg', 45, 15, 7, { aka: ['pescadilla fresca', 'pescadillas'], alg: ['pescado'] }),
  ing('Lubina', 'pescado', 'kg', 55, 15, 9, { aka: ['lubina entera', 'lubina de acuicultura', 'lubina de racion', 'robalo', 'lubina fresca'], alg: ['pescado'] }),
  ing('Lubina salvaje', 'pescado', 'kg', 55, 15, 26, { aka: ['lubina de estero', 'lubina de anzuelo', 'lubina salvaje entera'], alg: ['pescado'] }),
  ing('Lomo de lubina', 'pescado', 'kg', 3, 15, 20, { aka: ['filete de lubina', 'lomos de lubina', 'lubina en lomos', 'lubina lomo'], alg: ['pescado'] }),
  ing('Dorada', 'pescado', 'kg', 55, 15, 8.5, { aka: ['dorada entera', 'dorada de acuicultura', 'dorada de racion', 'doradas'], alg: ['pescado'] }),
  ing('Lomo de dorada', 'pescado', 'kg', 3, 15, 19, { aka: ['filete de dorada', 'lomos de dorada', 'dorada lomo'], alg: ['pescado'] }),
  ing('Rape entero', 'pescado', 'kg', 60, 18, 13, { aka: ['rape con cabeza', 'pixin entero'], alg: ['pescado'] }),
  ing('Cola de rape', 'pescado', 'kg', 25, 18, 22, { aka: ['rape', 'rape sin cabeza', 'colas de rape', 'pixin'], alg: ['pescado'] }),
  ing('Lomo de rape', 'pescado', 'kg', 3, 18, 30, { aka: ['medallones de rape', 'rape limpio', 'lomos de rape', 'medallon de rape'], alg: ['pescado'] }),
  ing('Salmón entero', 'pescado', 'kg', 38, 15, 9, { aka: ['salmon noruego entero', 'salmon fresco entero'], alg: ['pescado'] }),
  ing('Lomo de salmón', 'pescado', 'kg', 3, 15, 16, {
    aka: ['salmon', 'salmon fresco', 'lomos de salmon', 'supremas de salmon', 'salmon noruego', 'salmon lomo', 'suprema de salmon', 'filete de salmon', 'salmon sin piel'],
    alg: ['pescado'],
  }),
  ing('Salmón ahumado', 'pescado', 'kg', 0, 0, 28, { aka: ['salmon ahumado loncheado', 'salmon ahumado en lonchas'], alg: ['pescado'] }),
  ing('Atún rojo lomo', 'pescado', 'kg', 5, 10, 45, {
    aka: ['atun rojo', 'lomo de atun rojo', 'atun rojo de almadraba', 'atun de almadraba', 'tarantelo', 'atun rojo balfego', 'akami'],
    alg: ['pescado'],
  }),
  ing('Ventresca de atún rojo', 'pescado', 'kg', 5, 10, 65, { aka: ['toro de atun', 'otoro', 'ventresca de atun', 'parpatana', 'barriga de atun'], alg: ['pescado'] }),
  ing('Lomo de atún', 'pescado', 'kg', 5, 10, 22, { aka: ['atun', 'atun fresco', 'atun claro', 'atun yellowfin', 'rabil', 'lomo de atun claro', 'tacos de atun'], alg: ['pescado'] }),
  ing('Bonito del norte', 'pescado', 'kg', 5, 12, 14, { aka: ['bonito', 'bonito fresco', 'bonito del norte fresco', 'atun blanco', 'lomo de bonito'], alg: ['pescado'] }),
  ing('Bacalao desalado', 'pescado', 'kg', 5, 12, 17, {
    aka: ['bacalao', 'lomo de bacalao desalado', 'bacalao desalado lomo', 'lomo de bacalao', 'morro de bacalao', 'bacalao al punto de sal', 'tajada de bacalao'],
    alg: ['pescado'],
  }),
  ing('Bacalao desmigado', 'pescado', 'kg', 0, 10, 11, { aka: ['migas de bacalao', 'bacalao desmigado desalado', 'bacalao migas', 'bacalao en migas', 'desmigado de bacalao'], alg: ['pescado'] }),
  ing('Bacalao salado', 'pescado', 'kg', 5, 12, 15, { aka: ['bacalao en salazon', 'lomo de bacalao salado', 'bacalao seco'], alg: ['pescado'] }),
  ing('Rodaballo', 'pescado', 'kg', 50, 15, 16, { aka: ['rodaballo entero', 'rodaballo de acuicultura'], alg: ['pescado'] }),
  ing('Lenguado', 'pescado', 'kg', 45, 15, 20, { aka: ['lenguado entero', 'lenguados'], alg: ['pescado'] }),
  ing('Corvina', 'pescado', 'kg', 50, 15, 12, { aka: ['corvina entera', 'corvina de acuicultura', 'corvina fresca'], alg: ['pescado'] }),
  ing('Lomo de corvina', 'pescado', 'kg', 3, 15, 20, { aka: ['filete de corvina', 'corvina lomo', 'lomos de corvina'], alg: ['pescado'] }),
  ing('Besugo', 'pescado', 'kg', 55, 15, 22, { aka: ['besugo entero', 'besugo de la pinta'], alg: ['pescado'] }),
  ing('Pargo', 'pescado', 'kg', 55, 15, 20, { aka: ['pargo entero', 'pargo rojo'], alg: ['pescado'] }),
  ing('Mero', 'pescado', 'kg', 45, 15, 32, { aka: ['mero entero', 'lomo de mero'], alg: ['pescado'] }),
  ing('Sardina', 'pescado', 'kg', 45, 15, 4.5, { aka: ['sardinas', 'sardina fresca', 'espeto de sardinas'], alg: ['pescado'] }),
  ing('Boquerón', 'pescado', 'kg', 45, 15, 6, { aka: ['boqueron', 'boquerones', 'boqueron fresco', 'anchoa fresca', 'bocarte', 'boquerones frescos'], alg: ['pescado'] }),
  ing('Caballa', 'pescado', 'kg', 45, 15, 5, { aka: ['caballa fresca', 'verdel', 'xarda', 'estornino'], alg: ['pescado'] }),
  ing('Jurel', 'pescado', 'kg', 45, 15, 4, { aka: ['chicharro', 'jurel fresco'], alg: ['pescado'] }),
  ing('Salmonete', 'pescado', 'kg', 50, 15, 14, { aka: ['salmonetes', 'salmonete de roca'], alg: ['pescado'] }),
  ing('Gallo', 'pescado', 'kg', 45, 15, 12, { aka: ['gallo entero', 'meiga', 'gallos'], alg: ['pescado'] }),
  ing('Trucha', 'pescado', 'kg', 40, 15, 6.5, { aka: ['trucha arcoiris', 'trucha de rio', 'truchas'], alg: ['pescado'] }),
  ing('Cazón', 'pescado', 'kg', 10, 12, 8.5, { aka: ['cazon', 'cazon en adobo', 'bienmesabe', 'tacos de cazon'], alg: ['pescado'] }),
  ing('Pez espada', 'pescado', 'kg', 5, 15, 17, { aka: ['emperador', 'pez espada en rodajas', 'rodaja de emperador', 'filete de emperador'], alg: ['pescado'] }),
  ing('Sardina ahumada', 'conserva', 'kg', 0, 0, 30, { aka: ['sardinas ahumadas', 'lomos de sardina ahumada'], alg: ['pescado'] }),
  ing('Mojama', 'pescado', 'kg', 0, 0, 40, { aka: ['mojama de atun', 'mojama de barbate'], alg: ['pescado'] }),
  ing('Huevas de salmón', 'pescado', 'kg', 0, 0, 90, { aka: ['ikura', 'huevas de trucha', 'caviar rojo'], alg: ['pescado'] }),
  ing('Gulas', 'pescado', 'kg', 0, 0, 12, { aka: ['gula', 'gulas del norte', 'sucedaneo de angula', 'la gula del norte'], alg: ['pescado', 'huevo', 'soja'] }),
  ing('Surimi', 'pescado', 'kg', 0, 0, 6.5, {
    aka: ['palitos de cangrejo', 'palitos de surimi', 'barritas de surimi', 'palitos de mar', 'surimi de cangrejo'],
    alg: ['pescado', 'huevo', 'gluten', 'crustaceos'],
  }),

  // ── Crustáceos ──
  ing('Gamba roja', 'marisco', 'kg', 55, 5, 60, { aka: ['gamba roja de denia', 'gamba de palamos', 'gamba roja de huelva', 'gamba roja del mediterraneo', 'alistado'], alg: ['crustaceos'] }),
  ing('Gamba blanca', 'marisco', 'kg', 55, 5, 30, { aka: ['gamba blanca de huelva', 'gamba de huelva', 'gamba fresca', 'gamba entera', 'gamba cruda'], alg: ['crustaceos'] }),
  ing('Langostino crudo', 'marisco', 'kg', 50, 5, 11, {
    aka: ['langostino', 'langostinos', 'langostino congelado', 'langostino crudo congelado', 'langostino vannamei', 'langostino entero'],
    alg: ['crustaceos', 'sulfitos'],
  }),
  ing('Langostino cocido', 'marisco', 'kg', 50, 0, 18, { aka: ['langostinos cocidos', 'langostino cocido congelado', 'langostino de sanlucar'], alg: ['crustaceos', 'sulfitos'] }),
  ing('Langostino tigre', 'marisco', 'kg', 50, 5, 18, { aka: ['langostino tigre crudo', 'langostinos tigre', 'black tiger'], alg: ['crustaceos', 'sulfitos'] }),
  ing('Carabinero', 'marisco', 'kg', 50, 5, 65, { aka: ['carabineros', 'carabinero congelado'], alg: ['crustaceos'] }),
  ing('Cigala', 'marisco', 'kg', 60, 5, 55, { aka: ['cigalas', 'cigala tronco', 'cigala de tronco'], alg: ['crustaceos'] }),
  ing('Bogavante', 'marisco', 'kg', 10, 5, 35, { aka: ['bogavante azul', 'bogavante canadiense', 'bogavante vivo', 'bogavante europeo'], alg: ['crustaceos'] }),
  ing('Langosta', 'marisco', 'kg', 10, 5, 70, { aka: ['langosta roja', 'langosta viva'], alg: ['crustaceos'] }),
  ing('Buey de mar', 'marisco', 'kg', 65, 0, 18, { aka: ['buey de mar cocido', 'masera', 'cangrejo buey'], alg: ['crustaceos'] }),
  ing('Centolla', 'marisco', 'kg', 65, 0, 25, { aka: ['centollo', 'txangurro', 'changurro'], alg: ['crustaceos'] }),
  ing('Nécora', 'marisco', 'kg', 60, 0, 22, { aka: ['necora', 'necoras'], alg: ['crustaceos'] }),
  ing('Carne de cangrejo', 'marisco', 'kg', 0, 0, 40, { aka: ['pulpa de cangrejo', 'carne de buey de mar', 'carne de txangurro', 'cangrejo real'], alg: ['crustaceos'] }),
  ing('Percebe', 'marisco', 'kg', 40, 0, 90, { aka: ['percebes', 'percebe gallego'], alg: ['crustaceos'] }),
  ing('Gamba pelada congelada', 'congelado', 'kg', 0, 10, 11, {
    aka: ['gamba', 'gamba pelada', 'gamba arrocera', 'colas de gamba', 'gambon pelado', 'gamba congelada', 'gambas congeladas'],
    alg: ['crustaceos', 'sulfitos'],
  }),
  ing('Cola de langostino pelada', 'congelado', 'kg', 0, 10, 12.5, {
    aka: ['langostino pelado', 'colas de langostino', 'langostino pelado congelado', 'cola de langostino'],
    alg: ['crustaceos', 'sulfitos'],
  }),

  // ── Moluscos ──
  ing('Mejillón', 'marisco', 'kg', 5, 0, 2.2, { aka: ['mejillon', 'mejillones', 'mejillon de galicia', 'mejillon gallego', 'mejillon de batea', 'mejillon de roca'], alg: ['moluscos'] }),
  ing('Almeja japónica', 'marisco', 'kg', 3, 0, 13, { aka: ['almeja', 'almejas', 'almeja japonesa', 'almeja babosa', 'almeja rubia'], alg: ['moluscos'] }),
  ing('Almeja fina', 'marisco', 'kg', 3, 0, 35, { aka: ['almeja gallega', 'almeja de carril', 'almeja fina de carril', 'almeja fina gallega'], alg: ['moluscos'] }),
  ing('Chirla', 'marisco', 'kg', 3, 0, 9, { aka: ['chirlas'], alg: ['moluscos'] }),
  ing('Berberecho', 'marisco', 'kg', 5, 0, 16, { aka: ['berberechos', 'berberecho fresco', 'berberecho gallego'], alg: ['moluscos'] }),
  ing('Navaja', 'marisco', 'kg', 5, 0, 22, { aka: ['navajas', 'longueiron', 'navaja gallega'], alg: ['moluscos'] }),
  ing('Vieira', 'marisco', 'ud', 5, 10, 2.8, { aka: ['vieiras', 'vieira con concha', 'vieira en su concha', 'vieira media concha'], uw: 0.12, alg: ['moluscos'] }),
  ing('Carne de vieira', 'marisco', 'kg', 0, 15, 32, { aka: ['nuez de vieira', 'vieira sin concha', 'vieira limpia', 'coral de vieira', 'callo de vieira'], alg: ['moluscos'] }),
  ing('Zamburiña', 'marisco', 'kg', 0, 10, 16, { aka: ['zamburiñas', 'zamburiña media concha', 'volandeira'], uw: 0.02, alg: ['moluscos'] }),
  ing('Ostra', 'marisco', 'ud', 5, 0, 1.9, { aka: ['ostras', 'ostra gallega', 'ostra francesa', 'ostra rizada'], uw: 0.09, alg: ['moluscos'] }),
  ing('Pulpo crudo congelado', 'marisco', 'kg', 10, 45, 16, { aka: ['pulpo', 'pulpo crudo', 'pulpo congelado', 'pulpo entero', 'pulpo gallego', 'pulpo fresco'], alg: ['moluscos'] }),
  ing('Pulpo cocido', 'marisco', 'kg', 0, 5, 32, { aka: ['pata de pulpo cocida', 'patas de pulpo cocido', 'pulpo cocido en pata', 'pata de pulpo', 'tentaculo de pulpo'], alg: ['moluscos'] }),
  ing('Calamar', 'marisco', 'kg', 25, 25, 14, { aka: ['calamares', 'calamar fresco', 'calamar de potera', 'calamar nacional', 'calamar limpio'], alg: ['moluscos'] }),
  ing('Anillas de calamar', 'congelado', 'kg', 0, 25, 8, { aka: ['rabas', 'aros de calamar', 'tubo de calamar', 'calamar patagonico', 'calamar congelado', 'tiras de calamar'], alg: ['moluscos'] }),
  ing('Chipirón', 'marisco', 'kg', 20, 20, 12, { aka: ['chipiron', 'chipirones', 'chopitos', 'puntillitas', 'puntillas', 'chipiron de anzuelo'], alg: ['moluscos'] }),
  ing('Sepia', 'marisco', 'kg', 30, 25, 10, { aka: ['sepia fresca', 'choco', 'chocos', 'jibia', 'sepia limpia'], alg: ['moluscos'] }),
  ing('Tinta de calamar', 'marisco', 'kg', 0, 0, 35, { aka: ['tinta de sepia', 'tinta de chipiron', 'tinta', 'sobre de tinta'], alg: ['moluscos'] }),
  ing('Caracoles', 'marisco', 'kg', 0, 0, 12, { aka: ['caracol', 'cabrillas', 'caracoles cocidos', 'bigaros'], alg: ['moluscos'] }),

  // ── Caldos de base ──
  ing('Fumet de pescado', 'otros', 'l', 0, 0, 2.5, { aka: ['fumet', 'caldo de pescado', 'fondo de pescado', 'caldo de marisco', 'fumet de marisco', 'caldo de pescado y marisco'], alg: ['pescado', 'crustaceos', 'apio'], dens: 1 }),
];
