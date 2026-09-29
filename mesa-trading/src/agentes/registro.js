'use strict';
// Departamentos, salas y plantilla de agentes (§6.1). Los nombres propios son
// deterministas: misma entrada → mismos nombres, para que un reinicio no
// cambie de cara a nadie en el parqué. Dentro de una plantilla no se repite
// ningún nombre de pila.

const DEPARTAMENTOS = Object.freeze([
  { id: 'direccion', nombre: 'Dirección', color: '#f5b942', sala: 'direccion' },
  { id: 'macro', nombre: 'Macro', color: '#8b5cf6', sala: 'macro' },
  { id: 'analisis', nombre: 'Análisis', color: '#22c55e', sala: 'analisis' },
  { id: 'mesas', nombre: 'Mesas', color: '#3b82f6', sala: 'parque' },
  { id: 'riesgos', nombre: 'Riesgos', color: '#ef4444', sala: 'riesgos' },
  { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos' },
  { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio' },
].map(d => Object.freeze(d)));

const SALAS = Object.freeze(['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso']);

// Puestos fijos. El género del nombre casa con el del rol del contrato
// («Presidenta», «Jefa», «Director»…).
const FIJOS = Object.freeze([
  { id: 'cio', nombre: 'Carmen Aguirre', departamento: 'direccion', rol: 'Presidenta del comité', usaLLM: true,
    queDecide: 'Modo del fondo (NORMAL, DEFENSIVO o SOLO_CERRAR), multiplicadores por mesa de {0; 0,5; 1} y vetos de 24 h. Nunca toca los límites duros.' },
  { id: 'macro', nombre: 'Tomás Herrera', departamento: 'macro', rol: 'Estratega macro', usaLLM: false,
    queDecide: 'Régimen RISK-ON, NEUTRAL o RISK-OFF por regla fija (BTC y SPY frente a sus medias, volatilidad). Vota DEFENSIVO en RISK-OFF.' },
  { id: 'riesgos', nombre: 'Marta Solís', departamento: 'riesgos', rol: 'Jefa de riesgos', usaLLM: false,
    queDecide: 'Aprueba, recorta o veta cada orden contra los límites duros. Su voto DEFENSIVO en el comité es veto.' },
  { id: 'ejecutor', nombre: 'Raúl Campos', departamento: 'operaciones', rol: 'Ejecutor', usaLLM: false,
    queDecide: 'Nada de qué comprar: envía las órdenes aprobadas, espera la ejecución y no repite una orden ya enviada.' },
  { id: 'controller', nombre: 'Inés Ferrer', departamento: 'operaciones', rol: 'Controller', usaLLM: false,
    queDecide: 'Nada operativo: patrimonio, P&L, caída, exposición y conciliación con el bróker en cada latido.' },
  { id: 'laboratorio', nombre: 'Álvaro Medina', departamento: 'laboratorio', rol: 'Director de laboratorio', usaLLM: false,
    queDecide: 'Qué variantes se prueban (gramática cerrada) y si pasan las puertas del walk-forward para entrar en incubación.' },
  { id: 'auditor', nombre: 'Julián Prieto', departamento: 'laboratorio', rol: 'Auditor post-mortem', usaLLM: true,
    queDecide: 'La categoría de cada operación cerrada, de una lista cerrada, y la lección en una frase con cifras comprobadas.' },
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
  const { nombre } = asignarNombre(id, usados);
  return {
    id, nombre, departamento: 'analisis', rol: `Analista de ${etiqueta}`, usaLLM: true, sala: 'analisis',
    queDecide: `Nada operativo: nota técnica de ${etiqueta} (sesgo, SMA50, RSI, volatilidad) con cifras del código; el LLM solo la redacta.`,
    simbolo: simboloDe(activo), etiqueta,
  };
}

function agentePuesto(mesa, simbolo, usados) {
  const etiqueta = etiquetaDe(simbolo);
  const puestoId = `${mesa.id}-${etiqueta}`;
  const id = `puesto-${puestoId}`;
  const { nombre, genero } = asignarNombre(id, usados);
  return {
    id, nombre, departamento: 'mesas', rol: `${genero === 'f' ? 'Operadora' : 'Operador'} de ${mesa.nombre || mesa.id} · ${etiqueta}`,
    usaLLM: false, sala: 'parque',
    queDecide: `Abrir, mantener o cerrar ${etiqueta} según la regla de ${mesa.familia || mesa.id}; el tamaño lo fija el código y lo aprueba Riesgos.`,
    mesaId: mesa.id, simbolo: simboloDe(simbolo), etiqueta, puestoId,
  };
}

// Plantilla completa: fijos, un analista por activo disponible y un operador
// por puesto (mesa × símbolo). El orden de recorrido es el de la entrada, así
// que misma entrada → mismos nombres.
function crearPlantilla({ universo = [], mesas = [] } = {}) {
  const usados = new Set(FIJOS.map(a => pila(a.nombre)));
  const agentes = FIJOS.map(a => {
    const dep = DEPARTAMENTOS.find(d => d.id === a.departamento);
    return { ...a, sala: dep.sala };
  });
  const vistos = new Set();
  for (const activo of universo) {
    const e = etiquetaDe(activo);
    if (!e || vistos.has(e)) continue;
    vistos.add(e);
    agentes.push(agenteAnalista(activo, usados));
  }
  for (const mesa of mesas) agentes.push(...puestosDeMesa(mesa, { usados }));
  return agentes;
}

// Operadores de una mesa nueva (al contratar). `plantilla` es la actual, para
// no repetir nombres con quien ya está.
function puestosDeMesa(mesa, { plantilla = [], usados = null } = {}) {
  const u = usados || new Set([...FIJOS.map(a => pila(a.nombre)), ...plantilla.map(a => pila(a.nombre))]);
  const ids = new Set(plantilla.map(a => a.id));
  const salida = [];
  for (const s of (mesa && mesa.universo) || []) {
    const id = `puesto-${mesa.id}-${etiquetaDe(s)}`;
    if (ids.has(id)) continue;   // ya contratado: conserva su nombre
    ids.add(id);
    salida.push(agentePuesto(mesa, s, u));
  }
  return salida;
}

module.exports = { DEPARTAMENTOS, SALAS, crearPlantilla, puestosDeMesa, hash, NOMBRES };
