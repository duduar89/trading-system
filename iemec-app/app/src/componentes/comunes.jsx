import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

// Carga datos de la API y los refresca cada cierto tiempo (el panel de cabinas, cada 15 s).
export function useDatos(ruta, { cadaMs = 0 } = {}) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(() => api(ruta).then((d) => { setDatos(d); setError(null); }).catch((e) => setError(e.message)), [ruta]);
  useEffect(() => {
    cargar();
    if (!cadaMs) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') cargar(); }, cadaMs);
    return () => clearInterval(t);
  }, [cargar, cadaMs]);
  return { datos, error, recargar: cargar };
}

export function Cabecera({ antetitulo, titulo, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {antetitulo && <div className="etiqueta">{antetitulo}</div>}
        <h1 className="titulo text-3xl md:text-4xl mt-1">{titulo}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Cifra({ etiqueta, valor, detalle, tono = 'normal' }) {
  const color = tono === 'alerta' ? 'text-rosa' : tono === 'oro' ? 'text-oro' : '';
  return (
    <div className="tarjeta p-5 flex flex-col gap-1 min-w-0">
      <span className="etiqueta">{etiqueta}</span>
      <span className={`titulo cifras text-4xl not-italic ${color}`} style={{ fontStyle: 'normal' }}>{valor}</span>
      {detalle && <span className="text-sm" style={{ color: 'var(--texto-suave)' }}>{detalle}</span>}
    </div>
  );
}

const ESTADOS = {
  ia_activa: ['IA atendiendo', 'bg-aqua text-terciopelo-800'],
  esperando_paciente: ['Esperando al paciente', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
  espera_persona: ['Espera a una persona', 'bg-rosa/20 text-rosa'],
  persona: ['La lleva una persona', 'bg-oro/20 text-[#8a6a2a]'],
  pausada: ['Pausada', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
  cerrada: ['Cerrada', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
};
export function EstadoConversacion({ estado, urgente }) {
  const [texto, clase] = ESTADOS[estado] || [estado, ''];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${clase}`}>
      {urgente && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rosa" />}
      {urgente ? 'Urgente · ' : ''}{texto}
    </span>
  );
}

export function Vacio({ titulo, children }) {
  return (
    <div className="tarjeta p-10 text-center">
      <p className="titulo text-xl">{titulo}</p>
      {children && <p className="mt-2 text-sm" style={{ color: 'var(--texto-suave)' }}>{children}</p>}
    </div>
  );
}

export function Boton({ children, variante = 'contorno', ...props }) {
  const base = 'rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 cursor-pointer';
  const estilos = variante === 'lleno'
    ? 'bg-terciopelo-800 text-white hover:bg-terciopelo-700'
    : 'border border-[var(--borde)] hover:border-oro';
  return <button type="button" className={`${base} ${estilos}`} {...props}>{children}</button>;
}

export function Error({ texto }) {
  return texto ? <div role="alert" className="tarjeta p-4 text-sm text-rosa">{texto}</div> : null;
}
