import { useDatos, Cabecera, Cifra, Error } from '../componentes/comunes.jsx';
import { diaLargo, euros } from '../api.js';

// Según la hora de Madrid: el panel se abre a primera hora y también a última.
function saludo(ahora = new Date()) {
  const h = Number(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', hourCycle: 'h23' }).format(ahora));
  if (h >= 6 && h < 14) return 'Buenos días';
  if (h >= 14 && h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Hoy() {
  const { datos: d, error } = useDatos('/panel/hoy', { cadaMs: 30000 });
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const pendientes = [
    d.conversaciones.urgentes && { texto: `${d.conversaciones.urgentes} conversación urgente esperando a una persona`, ir: '#conversaciones', alerta: true },
    d.conversaciones.esperaPersona && { texto: `${d.conversaciones.esperaPersona} conversaciones esperan a una persona`, ir: '#conversaciones' },
    d.sinProximoPaso && { texto: `${d.sinProximoPaso} conversaciones sin próximo paso (tiene que ser cero)`, ir: '#conversaciones', alerta: true },
    d.tareas.vencidas && { texto: `${d.tareas.vencidas} tareas vencidas (llamadas, aprobaciones)`, ir: '#tareas', alerta: true },
    d.tareas.abiertas > d.tareas.vencidas && { texto: `${d.tareas.abiertas - d.tareas.vencidas} tareas abiertas (leads por llamar, conversaciones por contestar)`, ir: '#tareas' },
    d.resenasPorResponder && { texto: `${d.resenasPorResponder} reseñas de Google con respuesta preparada para aprobar`, ir: '#resenas' },
  ].filter(Boolean);
  return (
    <>
      <Cabecera antetitulo={diaLargo(d.fecha)} titulo={`${saludo()}, IEMEC`} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra etiqueta="Citas hoy" valor={d.citas.total} detalle={`${d.citas.confirmadas} confirmadas`} />
        <Cifra etiqueta="La IA atiende" valor={d.conversaciones.conIa} detalle="conversaciones abiertas" />
        <Cifra etiqueta="Seguimientos hoy" valor={d.seguimientosHoy} detalle="con la fecha que pidió cada paciente" />
        <Cifra etiqueta="Recuperado este mes" valor={euros(d.recuperadoMes.euros)} detalle={`${d.recuperadoMes.citas} citas cerradas por WhatsApp`} tono="oro" />
      </section>
      <section className="mt-8">
        <h2 className="etiqueta mb-3">Lo que necesita a una persona</h2>
        {pendientes.length === 0
          ? <div className="tarjeta p-6 text-sm" style={{ color: 'var(--texto-suave)' }}>Nada pendiente. Todas las conversaciones tienen su próximo paso.</div>
          : (
            <ul className="tarjeta divide-y divide-[var(--borde)]">
              {pendientes.map((p) => (
                <li key={p.texto}>
                  <a href={p.ir} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--superficie-2)]">
                    <span className="flex items-center gap-3 text-sm">
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${p.alerta ? 'bg-rosa' : 'bg-oro'}`} />{p.texto}
                    </span>
                    <span aria-hidden="true" className="text-oro">→</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
      </section>
    </>
  );
}
