/**
 * Léxico culinario español para el emparejamiento de ingredientes (core/matching).
 *
 * Todas las formas están normalizadas: minúsculas, sin tildes (ñ → n) y en singular.
 * Es un conjunto de datos estático: añadir palabras aquí mejora la precisión sin tocar el algoritmo.
 */

const words = (s: string): string[] => s.trim().split(/\s+/);

// ───────────────────────────── Vocabulario ─────────────────────────────

/** Sustantivos de ingredientes, cortes y productos. Dos palabras conocidas distintas nunca se confunden por erratas. */
export const FOOD_NOUNS = new Set(
  words(`
    tomate cebolla cebolleta cebollino chalota puerro ajo ajete pimiento guindilla jalapeno chile pepino pepinillo calabacin
    calabaza berenjena zanahoria chirivia nabo rabano remolacha apio hinojo alcachofa esparrago espinaca acelga lechuga escarola
    endibia canonigo rucula berro col repollo lombarda coliflor brocoli romanesco kale grelo borraja cardo judia guisante haba
    edamame maiz patata boniato batata yuca jengibre curcuma champinon seta boletus shiitake portobello trufa niscalo rebozuelo
    girgola aguacate brote alga wakame nori kombu okra tirabeque cogollo mezclum verdura hortaliza fruta fruto
    manzana pera platano banana naranja mandarina clementina limon lima pomelo fresa freson frambuesa mora arandano grosella
    cereza picota melocoton nectarina paraguayo albaricoque ciruela uva higo breva kiwi melon sandia pina mango papaya maracuya
    granada caqui chirimoya lichi coco datil pasa membrillo
    almendra avellana nuez nuezmoscada pistacho anacardo cacahuete pinon castana macadamia sesamo chia lino pipa girasol quinoa
    amapola arroz trigo avena centeno cebada espelta harina semola cuscus bulgur pasta espagueti macarron tallarin fideo lasana
    canelon ravioli tortellini penne fusilli noodle pan baguette chapata brioche hojaldre masa levadura maicena almidon garbanzo
    lenteja alubia judion soja tofu seitan tempeh picatoste tostada galleta bizcocho oblea tortilla empanadilla
    leche nata mantequilla margarina queso yogur kefir requeson cuajada helado natilla flan huevo clara yema
    aceite oliva colza orujo vinagre sal pimienta pimenton azafran comino oregano tomillo romero laurel perejil cilantro albahaca
    menta hierbabuena eneldo estragon salvia canela clavo vainilla anis cardamomo curry mostaza mayonesa ketchup alioli salsa
    tabasco miel azucar sacarina stevia sirope jarabe glucosa caramelo chocolate cacao cafe te infusion gelatina agar colorante
    especia hierba caldo fondo pastilla
    ternera vaca buey vacuno anojo novillo cerdo lechon cochinillo cordero lechal ternasco cabrito cabra oveja bufala pollo gallina
    capon picanton pavo pato oca conejo liebre codorniz perdiz faisan pichon jabali ciervo venado corzo caballo potro avestruz
    carne solomillo lomo entrecot chuleton chuleta costilla costillar carrillera rabo morcillo jarrete falda aguja babilla contra
    cadera picana secreto presa pluma abanico lagarto papada panceta tocino bacon jamon paleta paletilla pierna codillo manita
    oreja morro careta lengua higado rinon molleja callo seso pechuga muslo contramuslo ala alita carcasa magret foie
    hamburguesa albondiga salchicha chorizo salchichon fuet morcilla sobrasada butifarra cecina mortadela pate chistorra
    longaniza hueso tuetano entrana vacio filete escalope medallon churrasco cinta brazuelo espaldilla cuello pecho tapa culata
    lomito embutido charcuteria
    pescado merluza pescadilla bacalao salmon atun bonito rape lubina dorada rodaballo lenguado gallo sardina boqueron anchoa
    caballa jurel trucha besugo pargo corvina mero cherne emperador raya palometa sargo salmonete tilapia panga perca abadejo
    bacaladilla congrio cazon anguila angula gula arenque surimi hueva caviar mojama
    pulpo calamar chipiron sepia pota puntilla gamba gambon langostino camaron carabinero cigala bogavante langosta cangrejo
    necora centolla bueymar percebe mejillon almeja berberecho navaja ostra vieira zamburina erizo quisquilla marisco coquina
    chirla bigaro
    vino cava champan cerveza sidra agua refresco tonica gaseosa zumo licor brandy conac ron whisky ginebra vodka tequila
    vermut pacharan mosto horchata
    pure mermelada confitura compota crema sopa croqueta empanada pizza base hielo aceituna alcaparra banderilla turron mazapan
    polvoron churro croissant magdalena tarta pastel bollo nacho palomita
  `),
);

/** Variedades y tipos: conocidos, pero no son el "qué" del producto (tomate *pera*, patata *agria*). */
export const VARIETIES = new Set(
  words(`
    cherry raf kumato canario monalisa agria kennebec spunta lamuyo italiano california piquillo padron morron choricero nora
    cornicabra arbequina picual hojiblanca manzanilla gordal bomba basmati jazmin senia albufera carnaroli arborio vaporizado
    golden fuji gala reineta granny conferencia ercolini limonera blanquilla hass navel navelina iceberg romana trocadero batavia
    maravilla lollo roble perla tigre jumbo vannamei argentino angus wagyu duroc glas oleico alto fuerza floja trigueno
    manchego idiazabal cabrales roquefort parmesano mozzarella burrata cheddar gouda emmental gruyere brie camembert feta
    provolone gorgonzola edam grana pecorino halloumi mascarpone ricotta havarti torta casar tetilla mahon payoyo
    vera modena jerez bellota cebo recebo rioja ribera rueda albarino burgos guijuelo jabugo teruel bruselas maldon
    confit tempura
  `),
);

/** Calificativos débiles: pesan poco y nunca son el sustantivo principal. */
export const WEAK_QUALIFIERS = new Set(
  words(`
    fresco congelado refrigerado entero limpio pelado troceado fileteado loncheado laminado cortado picado molido grano natural
    ecologico bio organico grande pequeno mediano mini baby gordo fino grueso largo redondo campero dulce picante suave intenso
    tierno curado semicurado viejo anejo blanco negro rojo verde amarillo morado moreno tinto rosado crianza reserva joven
    montar cocinar cocina desalado salado maduro casero virgen extra gallego asturiano vasco desnatado semidesnatado desgrasado
    azucarado edulcorado integral deshuesado pasteurizado uht esterilizado crudo lavado listo precortado sinhueso sinpiel
    sinespina singluten sinlactosa sinsal sinazucar sincascara conhueso conpiel concascara conespina iberico
    fileteado tronco rodaja dado tira juliana brunoise
  `),
);

/** Transformaciones que convierten el ingrediente en otro producto (tomate ≠ tomate frito, pan ≠ pan rallado). */
export const TRANSFORMS = new Set(
  words(`
    frito triturado concentrado deshidratado polvo confitado encurtido escabeche almibar seco cocido asado ahumado tostado
    rebozado empanado rallado precocinado cocinado marinado adobado condensado evaporado caramelizado horneado conserva
    relleno glaseado hervido braseado desecado liofilizado
  `),
);

/** Cortes / partes: "Pollo" frente a "Pechuga de pollo" es sugerencia, no vínculo automático. */
export const CUTS = new Set(
  words(`
    solomillo lomo entrecot chuleton chuleta costilla costillar carrillera rabo morcillo jarrete falda aguja babilla contra cadera
    picana secreto presa pluma abanico lagarto papada panceta paleta paletilla pierna codillo manita oreja morro careta lengua
    higado rinon molleja pechuga muslo contramuslo ala alita carcasa magret filete escalope medallon churrasco cinta brazuelo
    espaldilla cuello pecho tapa culata lomito cola cabeza pata cogote ventresca tripa hueva lomo punta tentaculo hamburguesa
    albondiga
  `),
);

/** Palabras "genéricas" que se omiten cuando va el tipo concreto: "Queso parmesano" = "PARMESANO". */
export const HYPERNYMS: Record<string, Set<string>> = {
  queso: new Set(
    words(`manchego idiazabal cabrales roquefort parmesano mozzarella burrata cheddar gouda emmental gruyere brie camembert feta
      provolone gorgonzola edam grana pecorino halloumi mascarpone ricotta havarti tetilla mahon payoyo`),
  ),
  pasta: new Set(words('espagueti macarron tallarin fideo lasana canelon ravioli tortellini penne fusilli noodle')),
  pimiento: new Set(words('piquillo padron lamuyo choricero morron')),
};

// ───────────────────────────── Ruido ─────────────────────────────

/** Palabras vacías (se descartan salvo "sin"/"con" + calificativo, que se tratan aparte). */
export const STOPWORDS = new Set(
  words(`de del la las el los lo y e o u con en al a para por sin un una unos unas su sus tipo estilo the and of with for muy mas ni que`),
);

/** Envases, unidades y medidas. */
export const PACK_WORDS = new Set(
  words(`
    caja cj cja cjs bolsa bol bsa saco sac garrafa garraf gfa bandeja bdja bdj band bja bot bt botella botellin lata lt brik
    brick tetrabrik tetra pack pk paquete paq pqt pq malla granel bote tarro frasco cubo barqueta tarrina envase estuche sobre
    bidon barril blister fardo palet pallet barra rueda cuna loncha trozo taco diente rama ramita manojo ramillete hoja
    punado chorro chorrito cucharada cucharadita pizca taza vaso copa unidad ud uds u un und unds unid pieza pza pz kg kgs kilo k
    gr grs grm g gramo mg l lts ltr litro ml cl cc docena dz doc media medio cuarto x aprox approx aproximado pv racion porcion
    individual monodosis dosis tubo spray rollo cartucho keg tercio quinto magnum formato familiar ahorro maxi peso variable
    neto bruto tara retornable
  `),
);

/** Marcas, origen, marketing, calibres y referencias. */
export const NOISE_WORDS = new Set(
  words(`
    hacendado makro aro gourmet premium calidad seleccion selecto select especial eroski dia carrefour auchan alcampo lidl
    mercadona pascual puleva danone president kaiku hochland nestle knorr avecrem heinz hellmanns ybarra carbonell koipe borges
    dcoop coosur maheso pescanova findus frudesa bonduelle campofrio navidul argal revilla tarradellas piara calvo isabel albo
    orlando solis apis barilla garofalo bimbo panrico chef horeca hosteleria profesional foodservice food service fs nacional nac
    importacion import imp origen espana esp francia portugal marruecos italia holanda peru noruega noruego escocia escoces
    irlanda irlandes brasil china ecuador vietnam india tailandia uruguay ue cee eu precio pvp oferta promo promocion novedad
    gratis regalo lote lot ref referencia cod codigo art articulo ean sku plu cad caducidad fecha cons consumo pref preferente
    iva dto descuento gama iv cuarta quinta xl xxl xs cat categoria calibre cal primera segunda clase i ii iii super superior
    sel selec top plus gold classic clasico original tradicional artesano artesanal receta mg do dop doca igp sa sl
  `),
);

// ───────────────────────────── Abreviaturas de proveedor ─────────────────────────────

/** Abreviatura → expansión (una o varias palabras). Las dependientes de contexto se resuelven en matching.ts. */
export const ABBREVIATIONS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  const add = (keys: string, value: string) => {
    for (const k of words(keys)) map[k] = words(value);
  };
  add('aceit acei acet aceite', 'aceite');
  add('oliv', 'oliva');
  add('gir giras giraso', 'girasol');
  add('virg vir', 'virgen');
  add('aove evoo', 'aceite oliva virgen extra');
  add('tom tomat tmt', 'tomate');
  add('ceb ceboll cebol', 'cebolla');
  add('cebllta ceblta', 'cebolleta');
  add('zanah zanaho zanahor zana', 'zanahoria');
  add('pim pimto', 'pimiento');
  add('pimta', 'pimienta');
  add('pech pechug pchg', 'pechuga');
  add('poll', 'pollo');
  add('tern terner ter', 'ternera');
  add('cerd', 'cerdo');
  add('iber ibe iberic', 'iberico');
  add('cong congel cgl cngl conge ultracong ucong ultracongelado', 'congelado');
  add('champ champi champin champignon', 'champinon');
  add('solom solomi solomill', 'solomillo');
  add('entrct entrec entrcot', 'entrecot');
  add('lang langost langos lgt', 'langostino');
  add('bacal bacala', 'bacalao');
  add('merl merlu merluz', 'merluza');
  add('mozz mozza mozzar mozar mozarella mozarela muzzarella mozzarela', 'mozzarella');
  add('parmes parm parmig parmigiano parmesan', 'parmesano');
  add('mant mantq mantequ mantquilla mantec', 'mantequilla');
  add('har hna harin', 'harina');
  add('azuc az', 'azucar');
  add('lech', 'leche');
  add('sem semid semidesn semides semidesnat', 'semidesnatado');
  add('desn desnat', 'desnatado');
  add('ent', 'entero');
  add('berenj beren', 'berenjena');
  add('esparr esparrag', 'esparrago');
  add('alcach alcachof', 'alcachofa');
  add('puerr', 'puerro');
  add('lechug', 'lechuga');
  add('patat pat', 'patata');
  add('manz', 'manzana');
  add('naranj', 'naranja');
  add('lim', 'limon');
  add('frsc fsco', 'fresco');
  add('choriz chor', 'chorizo');
  add('jam', 'jamon');
  add('salch salchich', 'salchicha');
  add('morc morcil', 'morcilla');
  add('qso qeso ques', 'queso');
  add('yog yogurt yoghurt yoghourt', 'yogur');
  add('salm', 'salmon');
  add('gamb', 'gamba');
  add('calam calamr', 'calamar');
  add('mejill mejillo', 'mejillon');
  add('almej', 'almeja');
  add('vinag', 'vinagre');
  add('mostaz', 'mostaza');
  add('mayon mahon mahonesa', 'mayonesa');
  add('ketch catsup', 'ketchup');
  add('espag spaghetti spagueti espaguetti', 'espagueti');
  add('macarr', 'macarron');
  add('arr', 'arroz');
  add('garb garbanz', 'garbanzo');
  add('lent lentej', 'lenteja');
  add('jud', 'judia');
  add('alub', 'alubia');
  add('choc chocol chocolat', 'chocolate');
  add('levad', 'levadura');
  add('rall ralld', 'rallado');
  add('trit tritur', 'triturado');
  add('conc concent', 'concentrado');
  add('ahum', 'ahumado');
  add('cocid', 'cocido');
  add('filet fte', 'filete');
  add('chul chulet', 'chuleta');
  add('carrill carrilla', 'carrillera');
  add('hamb hambur burguer burger', 'hamburguesa');
  add('picad', 'picado');
  add('contram cmuslo', 'contramuslo');
  add('secr', 'secreto');
  add('espin', 'espinaca');
  add('calabac', 'calabacin');
  add('brocol broculi', 'brocoli');
  add('colif', 'coliflor');
  add('aguac', 'aguacate');
  add('platan', 'platano');
  add('frambu', 'frambuesa');
  add('arand', 'arandano');
  add('melocot', 'melocoton');
  add('cacah', 'cacahuete');
  add('almend', 'almendra');
  add('avell', 'avellana');
  add('pist', 'pistacho');
  add('oreg', 'oregano');
  add('perej', 'perejil');
  add('albah', 'albahaca');
  add('cilant', 'cilantro');
  add('tomill', 'tomillo');
  add('laur', 'laurel');
  add('canel', 'canela');
  add('vainil', 'vainilla');
  add('pav', 'pavo');
  add('cord', 'cordero');
  add('conej', 'conejo');
  add('codorn', 'codorniz');
  add('hvo huev', 'huevo');
  add('vac', 'vacuno');
  add('trocead troc', 'troceado');
  add('lonch lonchd', 'loncheado');
  add('lamin', 'laminado');
  add('limp', 'limpio');
  add('pel pelad', 'pelado');
  add('deshues', 'deshuesado');
  add('deshidr', 'deshidratado');
  add('ecol eco', 'ecologico');
  add('refrig', 'refrigerado');
  add('tallar', 'tallarin');
  add('fid', 'fideo');
  add('hojal', 'hojaldre');
  add('ciga', 'cigala');
  add('boga', 'bogavante');
  add('pulp', 'pulpo');
  add('chipir', 'chipiron');
  add('boquer', 'boqueron');
  add('anch', 'anchoa');
  add('sard', 'sardina');
  add('lub', 'lubina');
  add('rodab', 'rodaballo');
  add('lengu', 'lenguado');
  add('truch', 'trucha');
  add('emper', 'emperador');
  add('tint', 'tinto');
  add('blco bco', 'blanco');
  add('ngro', 'negro');
  add('dulc', 'dulce');
  add('picant', 'picante');
  add('peq', 'pequeno');
  add('gde grde', 'grande');
  add('curad', 'curado');
  add('semicur semic', 'semicurado');
  add('pimen', 'pimenton');
  add('nat', 'natural');
  return map;
})();

/** Sinónimos canónicos palabra → palabra. */
export const SYNONYMS: Record<string, string> = {
  papa: 'patata',
  zucchini: 'calabacin',
  zuchini: 'calabacin',
  calabacita: 'calabacin',
  aubergine: 'berenjena',
  culantro: 'cilantro',
  cayena: 'guindilla',
  paprika: 'pimenton',
  porcino: 'cerdo',
  puerco: 'cerdo',
  chancho: 'cerdo',
  beicon: 'bacon',
  palta: 'aguacate',
  ejote: 'judia',
  arveja: 'guisante',
  chicharo: 'guisante',
  elote: 'maiz',
  choclo: 'maiz',
  frijol: 'alubia',
  poroto: 'alubia',
  durazno: 'melocoton',
  frutilla: 'fresa',
  zapallo: 'calabaza',
  auyama: 'calabaza',
  roqueta: 'rucula',
  arugula: 'rucula',
  valeriana: 'canonigo',
  champignon: 'champinon',
  champi: 'champinon',
  cebollin: 'cebollino',
  ajoporro: 'puerro',
  pixin: 'rape',
  blanquilla: 'blanco',
  camperos: 'campero',
  pezespada: 'emperador',
  mahonesa: 'mayonesa',
  yoghurt: 'yogur',
  vainas: 'judia',
  cognac: 'conac',
  champagne: 'champan',
  hamburguer: 'hamburguesa',
  aceitunas: 'aceituna',
  ultracongelado: 'congelado',
  chile: 'guindilla',
};

/** Parejas de palabras (tras quitar palabras vacías) que forman un único concepto. */
export const PHRASES: Record<string, string[]> = {
  'crema leche': ['nata'],
  'crema montar': ['nata', 'montar'],
  'crema cocinar': ['nata', 'cocinar'],
  'pimienta cayena': ['guindilla'],
  'nuez moscada': ['nuezmoscada'],
  'pez espada': ['emperador'],
  'buey mar': ['bueymar'],
  'hierba buena': ['hierbabuena'],
  'cebolla tierna': ['cebolleta'],
  'cebolla tierno': ['cebolleta'],
  'ajo porro': ['puerro'],
  'azucar glas': ['azucar', 'glas'],
  'azucar glass': ['azucar', 'glas'],
  'judia verde': ['judia', 'verde'],
  'salsa soja': ['salsa', 'soja'],
};

/** Sinónimos débiles (similitud 0,8: se sugieren pero no se vinculan solos). */
export const WEAK_SYNONYMS: [string, string][] = [
  ['vacuno', 'ternera'],
  ['vaca', 'ternera'],
  ['buey', 'ternera'],
  ['anojo', 'ternera'],
  ['novillo', 'ternera'],
  ['menta', 'hierbabuena'],
  ['banana', 'platano'],
  ['pescadilla', 'merluza'],
  ['gambon', 'gamba'],
  ['ternasco', 'cordero'],
  ['lechal', 'cordero'],
  ['cochinillo', 'lechon'],
  ['picota', 'cereza'],
  ['freson', 'fresa'],
  ['batata', 'boniato'],
];

/** Expansiones débiles de una palabra (bacon ≈ panceta ahumada): limitan la puntuación a "sugerencia". */
export const WEAK_EXPANSIONS: Record<string, string[]> = {
  bacon: ['panceta', 'ahumado'],
};

// ───────────────────────────── Grupos contradictorios ─────────────────────────────

export type ConflictGroup = 'especie' | 'base' | 'color' | 'grasa' | 'curacion' | 'raza' | 'alimentacion' | 'estado' | 'sabor';

/** Palabra → [grupo, clase]. Dos nombres con clases distintas del mismo grupo (y ninguna común) se contradicen. */
export const GROUP_MEMBERS: Record<string, [ConflictGroup, string][]> = (() => {
  const map: Record<string, [ConflictGroup, string][]> = {};
  const add = (group: ConflictGroup, cls: string, keys: string) => {
    for (const k of words(keys)) (map[k] ??= []).push([group, cls]);
  };
  // Especie animal (carne, pescado, marisco, leche)
  add('especie', 'bovino', 'ternera vaca buey vacuno anojo novillo becerro angus wagyu');
  add('especie', 'porcino', 'cerdo iberico lechon cochinillo serrano duroc');
  add('especie', 'pollo', 'pollo gallina capon picanton');
  add('especie', 'pavo', 'pavo');
  add('especie', 'ovino', 'cordero lechal ternasco oveja');
  add('especie', 'caprino', 'cabrito cabra');
  add('especie', 'bufalo', 'bufala');
  add('especie', 'conejo', 'conejo');
  add('especie', 'pato', 'pato oca');
  add('especie', 'codorniz', 'codorniz');
  add('especie', 'perdiz', 'perdiz');
  add('especie', 'caza', 'jabali ciervo venado corzo');
  add('especie', 'caballo', 'caballo potro');
  for (const f of words(`merluza bacalao salmon atun bonito rape lubina dorada rodaballo lenguado gallo sardina boqueron anchoa caballa
    trucha besugo corvina mero emperador pulpo calamar sepia gamba langostino cigala bogavante langosta mejillon almeja vieira`)) {
    add('especie', f, f);
  }
  add('especie', 'merluza', 'pescadilla');
  // Base de aceites, harinas, leches y vinagres
  add('base', 'oliva', 'oliva');
  add('base', 'girasol', 'girasol');
  add('base', 'colza', 'colza');
  add('base', 'soja', 'soja');
  add('base', 'coco', 'coco');
  add('base', 'sesamo', 'sesamo');
  add('base', 'cacahuete', 'cacahuete');
  add('base', 'palma', 'palma');
  add('base', 'trigo', 'trigo');
  add('base', 'maiz', 'maiz');
  add('base', 'centeno', 'centeno');
  add('base', 'espelta', 'espelta');
  add('base', 'avena', 'avena');
  add('base', 'arroz', 'arroz');
  add('base', 'garbanzo', 'garbanzo');
  add('base', 'almendra', 'almendra');
  add('base', 'cebada', 'cebada');
  add('base', 'vaca', 'vaca');
  add('base', 'cabra', 'cabra');
  add('base', 'oveja', 'oveja');
  add('base', 'bufala', 'bufala');
  add('base', 'vino', 'vino');
  add('base', 'manzana', 'manzana sidra');
  add('base', 'jerez', 'jerez');
  add('base', 'modena', 'modena');
  // Color / tipo
  add('color', 'blanco', 'blanco');
  add('color', 'negro', 'negro');
  add('color', 'rojo', 'rojo');
  add('color', 'verde', 'verde');
  add('color', 'amarillo', 'amarillo');
  add('color', 'morado', 'morado');
  add('color', 'moreno', 'moreno');
  add('color', 'tinto', 'tinto');
  add('color', 'rosado', 'rosado');
  // Leche: materia grasa
  add('grasa', 'entero', 'entero');
  add('grasa', 'semidesnatado', 'semidesnatado');
  add('grasa', 'desnatado', 'desnatado desgrasado');
  // Queso: curación
  add('curacion', 'tierno', 'tierno fresco');
  add('curacion', 'semicurado', 'semicurado');
  add('curacion', 'curado', 'curado');
  add('curacion', 'viejo', 'viejo anejo');
  // Cerdo: raza y alimentación
  add('raza', 'iberico', 'iberico');
  add('raza', 'serrano', 'serrano');
  add('raza', 'duroc', 'duroc');
  add('alimentacion', 'bellota', 'bellota');
  add('alimentacion', 'cebo', 'cebo');
  add('alimentacion', 'recebo', 'recebo');
  // Estado y sabor (penalización leve)
  add('estado', 'fresco', 'fresco refrigerado');
  add('estado', 'congelado', 'congelado');
  add('sabor', 'dulce', 'dulce');
  add('sabor', 'picante', 'picante');
  return map;
})();

/** Tope de puntuación cuando hay contradicción en el grupo (o penalización si es leve, valor negativo). */
export const GROUP_SEVERITY: Record<ConflictGroup, { cap?: number; penalty?: number }> = {
  especie: { cap: 0.5 },
  base: { cap: 0.5 },
  color: { cap: 0.6 },
  raza: { cap: 0.6 },
  grasa: { cap: 0.65 },
  curacion: { cap: 0.7 },
  alimentacion: { cap: 0.72 },
  estado: { penalty: 0.05 },
  sabor: { cap: 0.78 },
};

/** Valor por defecto de un grupo según el sustantivo principal ("Harina" = harina de trigo; "Aceite" = de oliva). */
export const GROUP_DEFAULTS: Record<string, Partial<Record<ConflictGroup, string>>> = {
  aceite: { base: 'oliva' },
  harina: { base: 'trigo' },
  leche: { base: 'vaca', grasa: 'entero' },
  yogur: { base: 'vaca', grasa: 'entero' },
  nata: { base: 'vaca' },
  mantequilla: { base: 'vaca' },
  azucar: { color: 'blanco' },
  vinagre: { base: 'vino' },
  arroz: { color: 'blanco' },
};

// ───────────────────────────── Singular y género ─────────────────────────────

/** Palabras acabadas en -s que ya son singulares (o no deben tocarse). */
export const SINGULAR_EXCEPTIONS = new Set(
  words(`mas gas anis pais res tos cus cuscus couscous ananas jueves lunes martes miercoles viernes crisis tenis oasis bis dos tres
    seis mies iris lapsus virus gratis atlas ciempies apis extras brunoise bruselas humus hummus cactus`),
);

/** Plurales irregulares o que las reglas generales estropearían. */
export const PLURAL_OVERRIDES: Record<string, string> = {
  chiles: 'chile',
  vinagres: 'vinagre',
  hojaldres: 'hojaldre',
  postres: 'postre',
  sobres: 'sobre',
  tomates: 'tomate',
  aceites: 'aceite',
  cafes: 'cafe',
  tes: 'te',
  pies: 'pie',
  menus: 'menu',
  canapes: 'canape',
  pates: 'pate',
  pures: 'pure',
  bacalaos: 'bacalao',
  maices: 'maiz',
  arroces: 'arroz',
  nueces: 'nuez',
  espaguetis: 'espagueti',
  macarrones: 'macarron',
  raviolis: 'ravioli',
  noodles: 'noodle',
  kiwis: 'kiwi',
  brocolis: 'brocoli',
  alcaparras: 'alcaparra',
  nachos: 'nacho',
  chips: 'chip',
  quesos: 'queso',
  croissants: 'croissant',
  gnocchis: 'gnocchi',
};

/** Adjetivos femeninos → masculino (para comparar "presa ibérica" con "cerdo ibérico"). */
export const FEMININE_ADJECTIVES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const m of words(`fresco congelado refrigerado entero limpio pelado troceado fileteado loncheado laminado cortado picado molido
    ecologico organico pequeno mediano gordo fino grueso largo redondo campero tierno curado semicurado viejo anejo blanco negro rojo
    amarillo morado moreno tinto rosado desalado salado maduro casero gallego asturiano vasco desnatado semidesnatado desgrasado
    azucarado edulcorado deshuesado pasteurizado esterilizado crudo lavado listo precortado iberico frito triturado concentrado
    deshidratado confitado encurtido seco cocido asado ahumado tostado rebozado empanado rallado precocinado cocinado marinado
    adobado condensado evaporado caramelizado horneado relleno glaseado hervido braseado desecado liofilizado italiano argentino
    manchego trigueno vaporizado`)) {
    if (m.endsWith('o')) map[`${m.slice(0, -1)}a`] = m;
  }
  map.agria = 'agria';
  return map;
})();

/** Sustantivos que no admiten el adjetivo femenino como sustantivo principal cuando van en primera posición. */
export const NOUN_WHEN_FIRST = new Set(words('empanada tostada asado cocido frito rebozado seco relleno'));

// ───────────────────────────── Presentación (cleanProductName) ─────────────────────────────

/** Formas con tilde / ñ para mostrar nombres limpios. */
export const DISPLAY_FORMS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const w of words(`limón jamón azúcar champiñón pimentón calabacín atún plátano espárrago maíz salmón ibérico rúcula brócoli
    melocotón mejillón macarrón boquerón chipirón café té anís ají lechón puré jalapeño piña caña castaña judía judión canónigo
    orégano azafrán estragón chirivía rábano fresón arándano melón sandía dátil piñón sésamo chía cuscús sémola tallarín lasaña
    coñac infusión chuletón picaña hígado riñón salchichón albóndiga nécora zamburiña jabalí faisán pichón capón picantón perdiz
    avestruz brazuelo cazón mojama percebe cigala bígaro lichi maracuyá caquí champán vermú pacharán crème mahón idiazábal
    albariño módena padrón teruel lomito ñora gruyère pequeño añejo ecológico orgánico gallego plátano berenjena apio
    rábano cóctel tomillo ternasco menú canapé paté gnocchi pâté bechamel carbón jengibre cúrcuma cardamomo alcaparra
    medallón escalope magdalena turrón mazapán polvorón croissant nachos fideuá trigueño bogavante centolla múrgula
    quínoa bulgur tofu seitán tempeh kéfir requesón túnel limón`)) {
    const key = w
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    if (key !== w) map[key] = w;
  }
  return map;
})();

/** Nombres propios (denominaciones, orígenes) que se escriben con mayúscula. */
export const PROPER_NOUNS: Record<string, string> = {
  vera: 'Vera',
  modena: 'Módena',
  jerez: 'Jerez',
  rioja: 'Rioja',
  ribera: 'Ribera',
  rueda: 'Rueda',
  albarino: 'Albariño',
  burgos: 'Burgos',
  guijuelo: 'Guijuelo',
  jabugo: 'Jabugo',
  teruel: 'Teruel',
  padron: 'Padrón',
  bruselas: 'Bruselas',
  maldon: 'Maldon',
  idiazabal: 'Idiazábal',
  cabrales: 'Cabrales',
  roquefort: 'Roquefort',
  mahon: 'Mahón',
  casar: 'Casar',
  valencia: 'Valencia',
  navarra: 'Navarra',
};

/** Orígenes/calificativos que se muestran con preposición: "Pimentón dulce de la Vera", "Jamón ibérico de bellota". */
export const DISPLAY_PREFIX: Record<string, string> = {
  vera: 'de la',
  modena: 'de',
  jerez: 'de',
  bellota: 'de',
  cebo: 'de',
  recebo: 'de',
  burgos: 'de',
  guijuelo: 'de',
  jabugo: 'de',
  teruel: 'de',
  padron: 'de',
  piquillo: 'del',
  bruselas: 'de',
  casar: 'del',
  temporada: 'de',
  corral: 'de',
};

/** Sustantivos que llevan "de" + origen: "Solomillo de ternera", "Aceite de oliva", "Harina de trigo". */
export const DE_HEADS = new Set(
  words(`aceite harina solomillo pechuga muslo contramuslo lomo filete chuleta chuleton costilla carrillera entrecot jarrete paleta
    paletilla pierna pata ala alita higado rinon carne queso leche zumo caldo fondo crema pure mermelada confitura cola cabeza
    hamburguesa albondiga salchicha tarta helado yogur vinagre miel lengua secreto presa pluma magret carcasa hueso escalope
    medallon codillo manita oreja morro careta papada falda aguja babilla morcillo rabo cuello tapa churrasco lomito brazuelo
    ventresca tripa hueva lomito sopa crema masa tortilla croqueta empanadilla`),
);

/** Sustantivos "origen" que admiten ese "de" delante. */
export const DE_SOURCES = new Set(
  words(`ternera vaca buey vacuno anojo cerdo cordero cabrito pollo gallina pavo pato conejo codorniz oca cabra oveja bufala oliva
    girasol colza orujo trigo maiz arroz garbanzo soja coco almendra avena espelta centeno naranja limon manzana tomate fresa
    melocoton pina uva frambuesa arandano mango merluza bacalao salmon atun rape pulpo calamar gamba langostino rape bonito
    sepia marisco pescado verdura ave cebolla vino sidra jerez setas boletus seta calabaza calabacin patata espinaca
    esparrago champinon pimiento chocolate vainilla fresa limon cafe cacao avellana pistacho nuez castana`),
);

/** Sustantivos femeninos que no acaban en -a (para concordar adjetivos expandidos de abreviaturas). */
export const FEMININE_NOUNS = new Set(words('leche carne sal miel nuez col coliflor flor piel legumbre codorniz perdiz ubre hiel'));
/** Sustantivos masculinos que acaban en -a. */
export const MASCULINE_A_NOUNS = new Set(words('dia mapa tema problema'));
