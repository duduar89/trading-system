import { useState } from 'react';
import { api } from '../api.js';
import { useDatos, Cabecera, Error } from '../componentes/comunes.jsx';

// Qué tratamiento se puede hacer en qué cabina. Si no se marca nada, vale cualquier sala de su tipo.
export default function Ajustes() {
  const { datos: d, error, recargar } = useDatos('/panel/ajustes/salas-tratamientos');
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState(null);
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const cambiar = async (t, salaId) => {
    const nuevas = t.salas.includes(salaId) ? t.salas.filter((s) => s !== salaId) : [...t.salas, salaId];
    setGuardando(t.id);
    await api(`/panel/ajustes/salas-tratamientos/${encodeURIComponent(t.id)}`, { metodo: 'PUT', cuerpo: { salas: nuevas } });
    setGuardando(null);
    recargar();
  };
  const lista = d.tratamientos.filter((t) => !filtro || t.nombre.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <>
      <Cabecera antetitulo="Ajustes" titulo="Cabinas y tratamientos">
        <label htmlFor="buscar" className="sr-only">Buscar tratamiento</label>
        <input id="buscar" placeholder="Buscar tratamiento…" value={filtro} onChange={(e) => setFiltro(e.target.value)}
          className="rounded-full border border-[var(--borde)] bg-transparent px-4 py-2 text-sm" />
      </Cabecera>
      <p className="mb-4 max-w-2xl text-sm" style={{ color: 'var(--texto-suave)' }}>
        Marca en qué cabina se hace cada tratamiento. El motor de agenda solo ofrece huecos en esas cabinas, con el aparato que necesita y respetando las comidas. Lo que está en gris es lo que se deduce del tipo de sala; al marcar una casilla queda fijado a mano.
      </p>
      <div className="tarjeta overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--borde)]">
              <th scope="col" className="sticky left-0 bg-[var(--superficie)] px-4 py-3 text-left etiqueta">Tratamiento</th>
              {d.salas.map((s) => <th key={s.id} scope="col" className="px-3 py-3 text-center etiqueta">{s.nombre}</th>)}
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} className="border-b border-[var(--borde)] last:border-0">
                <th scope="row" className="sticky left-0 bg-[var(--superficie)] px-4 py-2.5 text-left font-normal">
                  {t.nombre}
                  {t.equipo_codigo && <span className="ml-2 text-xs text-oro">· {t.equipo_codigo}</span>}
                </th>
                {d.salas.map((s) => (
                  <td key={s.id} className="px-3 py-2.5 text-center">
                    <input type="checkbox" aria-label={`${t.nombre} en ${s.nombre}`} checked={t.salas.includes(s.id)} disabled={guardando === t.id}
                      onChange={() => cambiar(t, s.id)} className={`h-4 w-4 accent-[#123f3e] ${t.porTipo ? 'opacity-50' : ''}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
