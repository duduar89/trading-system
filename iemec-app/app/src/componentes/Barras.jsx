// Barras horizontales de una sola serie (magnitud): un solo tono de la marca, extremo redondeado
// de 4 px anclado a la base, valores en tinta (no en el color de la barra) y tabla accesible.
export default function Barras({ titulo, filas, formato = (v) => v, vacio = 'Sin datos todavía' }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <figure className="tarjeta p-5 min-w-0">
      <figcaption className="etiqueta mb-4">{titulo}</figcaption>
      {filas.length === 0 ? <p className="text-sm" style={{ color: 'var(--texto-suave)' }}>{vacio}</p> : (
        <table className="w-full border-separate" style={{ borderSpacing: '0 8px' }}>
          <tbody>
            {filas.map((f) => (
              <tr key={f.etiqueta} title={`${f.etiqueta}: ${formato(f.valor)}`}>
                <th scope="row" className="w-2/5 pr-3 text-left text-sm font-normal align-middle">{f.etiqueta}</th>
                <td className="align-middle">
                  <div className="h-3.5 rounded-r-[4px] transition-[width]" style={{ width: `${Math.max(2, (f.valor / max) * 100)}%`, background: 'var(--acento)' }} />
                </td>
                <td className="w-16 pl-3 text-right text-sm cifras align-middle">{formato(f.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
