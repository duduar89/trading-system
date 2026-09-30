'use strict';
// Departamentos, salas y plantilla de agentes (§6.1). Los nombres propios son
// deterministas: misma entrada → mismos nombres, para que un reinicio no
// cambie de cara a nadie en el parqué. Dentro de una plantilla no se repite
// ningún nombre de pila.

const universoMod = require('../mercado/universo');

// `queHace` (30-sep-2026): qué hace el departamento, en una frase llana y sin
// cifras, para la pestaña Equipo del panel (§8).
const DEPARTAMENTOS = Object.freeze([
  { id: 'direccion', nombre: 'Dirección', color: '#f5b942', sala: 'direccion',
    queHace: 'Preside el comité: decide si el fondo sigue normal, va con la mitad de tamaño o solo cierra posiciones.' },
  { id: 'macro', nombre: 'Macro', color: '#8b5cf6', sala: 'macro',
    queHace: 'Lee el ambiente del mercado en conjunto (apetito, neutral o miedo) y pide prudencia cuando hay miedo.' },
  { id: 'analisis', nombre: 'Análisis', color: '#22c55e', sala: 'analisis',
    queHace: 'Un analista por activo: sigue su precio cada hora y escribe una nota para los demás. No compran ni venden.' },
  { id: 'mesas', nombre: 'Mesas', color: '#3b82f6', sala: 'parque',
    queHace: 'Los operadores: cada uno aplica la regla de su estrategia a un activo y propone comprar o vender.' },
  { id: 'riesgos', nombre: 'Riesgos', color: '#ef4444', sala: 'riesgos',
    queHace: 'Revisa cada orden antes de que salga contra los límites de seguridad: la aprueba, la recorta o la prohíbe.' },
  { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos',
    queHace: 'Manda al bróker las órdenes aprobadas y lleva las cuentas del fondo, comparándolas con las del bróker.' },
  { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio',
    queHace: 'Prueba estrategias nuevas con precios del pasado y repasa por qué se ganó o se perdió en cada operación.' },
].map(d => Object.freeze(d)));

const SALAS = Object.freeze(['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso']);

// Puestos fijos. El género del nombre casa con el del rol del contrato
// («Presidenta», «Jefa», «Director»…). `genero` ('f' | 'm') lo usa la cara
// del panel (barba solo en hombres), igual que el rol de los operadores.
const FIJOS = Object.freeze([
  { id: 'cio', nombre: 'Carmen Aguirre', genero: 'f', departamento: 'direccion', rol: 'Presidenta del comité', usaLLM: true,
    queDecide: 'Modo del fondo (NORMAL, DEFENSIVO o SOLO_CERRAR), multiplicadores por mesa de {0; 0,5; 1} y vetos de 24 h. Nunca toca los límites duros.',
    queHace: 'Preside la reunión del comité cada 4 horas: escucha a los jefes y decide si el fondo sigue normal, va con la mitad de tamaño o solo cierra. No puede saltarse los límites de seguridad.' },
  { id: 'macro', nombre: 'Tomás Herrera', genero: 'm', departamento: 'macro', rol: 'Estratega macro', usaLLM: false,
    queDecide: 'Régimen RISK-ON, NEUTRAL o RISK-OFF por regla fija (BTC y SPY frente a sus medias, volatilidad; VIXY si hay dato). Vota DEFENSIVO en RISK-OFF.',
    queHace: 'Mira el mercado en conjunto (si el bitcoin y la bolsa van por encima de su media, si hay nervios) y dice si el ambiente es de apetito, neutral o de miedo. Con miedo, pide prudencia en el comité.' },
  { id: 'riesgos', nombre: 'Marta Solís', genero: 'f', departamento: 'riesgos', rol: 'Jefa de riesgos', usaLLM: false,
    queDecide: 'Aprueba, recorta o veta cada orden contra los límites duros. Su voto DEFENSIVO en el comité es veto.',
    queHace: 'Revisa cada compra antes de que salga: si arriesga demasiado la recorta o la prohíbe. Vigila las pérdidas del día y la caída del fondo, y si se pasan de la raya para todo.' },
  { id: 'ejecutor', nombre: 'Raúl Campos', genero: 'm', departamento: 'operaciones', rol: 'Ejecutor', usaLLM: false,
    queDecide: 'Nada de qué comprar: envía las órdenes aprobadas, espera la ejecución y no repite una orden ya enviada.',
    queHace: 'Manda al bróker las compras y ventas ya aprobadas y comprueba que se han hecho. No elige qué comprar: solo ejecuta, y nunca manda dos veces la misma orden.' },
  { id: 'controller', nombre: 'Inés Ferrer', genero: 'f', departamento: 'operaciones', rol: 'Controller', usaLLM: false,
    queDecide: 'Nada operativo: patrimonio, P&L, caída, exposición y conciliación con el bróker en cada latido.',
    queHace: 'Lleva las cuentas: cuánto vale el fondo, cuánto gana o pierde hoy y cuánto está invertido. Cada minuto comprueba que lo que dicen nuestros libros coincide con lo que tiene el bróker.' },
  { id: 'laboratorio', nombre: 'Álvaro Medina', genero: 'm', departamento: 'laboratorio', rol: 'Director de laboratorio', usaLLM: false,
    queDecide: 'Qué variantes se prueban (gramática cerrada) y si pasan las puertas del walk-forward para entrar en incubación.',
    queHace: 'Inventa cada semana variantes de las estrategias y las prueba con años de precios pasados, por tramos que no ha visto al diseñarlas. Solo aprueba las que pasan seis exámenes; las aprobadas empiezan en prueba con poco dinero.' },
  { id: 'auditor', nombre: 'Julián Prieto', genero: 'm', departamento: 'laboratorio', rol: 'Auditor post-mortem', usaLLM: true,
    queDecide: 'La categoría de cada operación cerrada, de una lista cerrada, y la lección en una frase con cifras comprobadas.',
    queHace: 'Repasa cada noche las operaciones cerradas: por qué se ganó o se perdió (señal falsa, stop demasiado cerca, ir contra el mercado…) y apunta la lección. Sus pistas alimentan al laboratorio.' },
]);

// Nombres de pila con su género (para «Operador»/«Operadora»). Ninguno
// coincide con los de los puestos fijos.
const NOMBRES = Object.freeze([
  ['Lucía', 'f'], ['Hugo', 'm'], ['Sofía', 'f'], ['Mateo', 'm'], ['Paula', 'f'], ['Daniel', 'm'], ['Elena', 'f'],
  ['Pablo', 'm'], ['Irene', 'f'], ['Adrián', 'm'], ['Claudia', 'f'], ['Javier', 'm'], ['Nerea', 'f'], ['Sergio', 'm'],
  ['Alba', 'f'], ['Marcos', 'm'], ['Noelia', 'f'], ['Diego', 'm'], ['Rocío', 'f'], ['Iván', 'm'], ['Beatriz', 'f'],
  ['Rubén', 'm'], ['Lorena', 'f'], ['Óscar', 'm'], ['Cristina', 'f'], ['Gonzalo', 'm'], ['Andrea', 'f'], ['Víctor', 'm'],
  ['Silvia', 'f'], ['Ignacio', 'm'], ['Patricia', 'f'], ['Samuel', 'm'], ['Raquel', 'f'], ['Gabriel', 'm'], ['Natalia', 'f'],
  ['Alberto', 'm'], ['Miriam', 'f'], ['Emilio', 'm'], ['Teresa', 'f'], ['Rodrigo', 'm'], ['Ainhoa', 'f'], ['Héctor', 'm'],
  ['Laura', 'f'], ['Jaime', 'm'], ['Nuria', 'f'], ['Fernando', 'm'], ['Eva', 'f'], ['Ángel', 'm'], ['Pilar', 'f'],
  ['Enrique', 'm'], ['Rosa', 'f'], ['Felipe', 'm'], ['Olga', 'f'], ['Joaquín', 'm'], ['Victoria', 'f'], ['Martín', 'm'],
  ['Susana', 'f'], ['Nicolás', 'm'], ['Almudena', 'f'], ['Rafael', 'm'], ['Montse', 'f'], ['Esteban', 'm'], ['Amaia', 'f'],
  ['Lorenzo', 'm'], ['Celia', 'f'], ['Marcelo', 'm'], ['Aitana', 'f'], ['Bruno', 'm'], ['Carla', 'f'], ['Gregorio', 'm'],
  ['Maite', 'f'], ['Salvador', 'm'], ['Lidia', 'f'], ['Arturo', 'm'], ['Vera', 'f'], ['Germán', 'm'], ['Yolanda', 'f'],
  ['Ramiro', 'm'], ['Inma', 'f'], ['Borja', 'm'],
].map(([nombre, genero]) => Object.freeze({ nombre, genero })));

const APELLIDOS = Object.freeze([
  'García', 'Martín', 'López', 'Sánchez', 'Romero', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Serrano',
  'Molina', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias', 'Núñez', 'Garrido', 'Cortés',
  'Lozano', 'Guerrero', 'Cano', 'Méndez', 'Cruz', 'Calvo', 'Gallego', 'Vidal', 'León', 'Márquez', 'Peña', 'Cabrera',
  'Flores', 'Santana', 'Díez', 'Pascual',
]);

// FNV-1a de 32 bits: estable entre versiones de Node (no depende de Math.random).
function hash(texto) {
  let h = 0x811c9dc5;
  for (const c of String(texto)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const etiquetaDe = (a) => {
  if (a && typeof a === 'object') return a.etiqueta || String(a.simbolo || '').split('/')[0];
  return String(a || '').split('/')[0];
};
const simboloDe = a => (a && typeof a === 'object' ? a.simbolo : String(a || ''));

// Asigna nombre sin repetir el de pila: prueba desde la posición del hash y
// avanza. Si se agotara la lista, repite nombre de pila con otro apellido.
function asignarNombre(id, usados) {
  const i0 = hash(id) % NOMBRES.length;
  for (let k = 0; k < NOMBRES.length; k++) {
    const n = NOMBRES[(i0 + k) % NOMBRES.length];
    if (!usados.has(n.nombre)) {
      usados.add(n.nombre);
      const apellido = APELLIDOS[hash(id + '|apellido') % APELLIDOS.length];
      return { nombre: `${n.nombre} ${apellido}`, genero: n.genero };
    }
  }
  const n = NOMBRES[i0];
  for (let k = 0; k < APELLIDOS.length; k++) {
    const nombre = `${n.nombre} ${APELLIDOS[(hash(id + '|apellido') + k) % APELLIDOS.length]}`;
    if (!usados.has(nombre)) { usados.add(nombre); return { nombre, genero: n.genero }; }
  }
  return { nombre: `${n.nombre} ${id}`, genero: n.genero };
}

function pila(nombreCompleto) { return String(nombreCompleto).split(' ')[0]; }

function agenteAnalista(activo, usados) {
  const etiqueta = etiquetaDe(activo);
  const id = `analista-${etiqueta}`;
  const { nombre, genero } = asignarNombre(id, usados);
  return {
    id, nombre, genero, departamento: 'analisis', rol: `Analista de ${etiqueta}`, usaLLM: true, sala: 'analisis',
    queDecide: `Nada operativo: nota técnica de ${etiqueta} (sesgo, SMA50, RSI, volatilidad) con cifras del código; el LLM solo la redacta.`,
    queHace: `Sigue ${etiqueta} cada hora: si va por encima o por debajo de su media, si viene con fuerza y lo nervioso que está. Escribe una nota para los demás; no compra ni vende.`,
    simbolo: simboloDe(activo), etiqueta,
  };
}

function agentePuesto(mesa, simbolo, usados) {
  const etiqueta = etiquetaDe(simbolo);
  const puestoId = `${mesa.id}-${etiqueta}`;
  const id = `puesto-${puestoId}`;
  const { nombre, genero } = asignarNombre(id, usados);
  return {
    id, nombre, genero, departamento: 'mesas', rol: `${genero === 'f' ? 'Operadora' : 'Operador'} de ${mesa.nombre || mesa.id} · ${etiqueta}`,
    usaLLM: false, sala: 'parque',
    queDecide: `Abrir, mantener o cerrar ${etiqueta} según la regla de ${mesa.familia || mesa.id}; el tamaño lo fija el código y lo aprueba Riesgos.`,
    queHace: `Aplica la estrategia de ${mesa.nombre || mesa.id} a ${etiqueta}: cuando la regla lo dice, propone comprar o vender. No decide cuánto: eso lo calcula el código y lo revisa Riesgos.`,
    mesaId: mesa.id, simbolo: simboloDe(simbolo), etiqueta, puestoId,
  };
}

// Plantilla completa: fijos, un analista por activo disponible y un operador
// por puesto (mesa × símbolo). El orden de recorrido es el de la entrada, así
// que misma entrada → mismos nombres.
// Los activos de la ampliación del 30-sep-2026 (universo.generacion 2: XRP,
// LTC, BCH, ADA y DIA) se nombran en una segunda vuelta, después de todos los
// demás: así su llegada no cambia la cara de nadie que ya estaba. Un activo
// de solo dato (VIXY) no tiene analista ni puesto.
function crearPlantilla({ universo = [], mesas = [] } = {}) {
  const usados = new Set(FIJOS.map(a => pila(a.nombre)));
  const agentes = FIJOS.map(a => {
    const dep = DEPARTAMENTOS.find(d => d.id === a.departamento);
    return { ...a, sala: dep.sala };
  });
  const operables = universo.filter(a => !universoMod.esSoloDato(simboloDe(a)));
  const vistos = new Set();
  const nuevo = a => universoMod.generacion(simboloDe(a)) > 1;
  const analistas = lista => {
    for (const activo of lista) {
      const e = etiquetaDe(activo);
      if (!e || vistos.has(e)) continue;
      vistos.add(e);
      agentes.push(agenteAnalista(activo, usados));
    }
  };
  analistas(operables.filter(a => !nuevo(a)));
  const ids = new Set();
  const puestos = soloNuevos => {
    for (const mesa of mesas) {
      const universoMesa = ((mesa && mesa.universo) || []).filter(s => !universoMod.esSoloDato(simboloDe(s)) && nuevo(s) === soloNuevos);
      for (const a of puestosDeMesa({ ...mesa, universo: universoMesa }, { usados })) {
        if (ids.has(a.id)) continue;
        ids.add(a.id);
        agentes.push(a);
      }
    }
  };
  puestos(false);
  analistas(operables.filter(nuevo));
  puestos(true);
  return agentes;
}

// Operadores de una mesa nueva (al contratar). `plantilla` es la actual, para
// no repetir nombres con quien ya está.
function puestosDeMesa(mesa, { plantilla = [], usados = null } = {}) {
  const u = usados || new Set([...FIJOS.map(a => pila(a.nombre)), ...plantilla.map(a => pila(a.nombre))]);
  const ids = new Set(plantilla.map(a => a.id));
  const salida = [];
  for (const s of (mesa && mesa.universo) || []) {
    if (universoMod.esSoloDato(simboloDe(s))) continue;   // VIXY: nadie lo opera
    const id = `puesto-${mesa.id}-${etiquetaDe(s)}`;
    if (ids.has(id)) continue;   // ya contratado: conserva su nombre
    ids.add(id);
    salida.push(agentePuesto(mesa, s, u));
  }
  return salida;
}

module.exports = { DEPARTAMENTOS, SALAS, crearPlantilla, puestosDeMesa, hash, NOMBRES };
