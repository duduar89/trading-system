import { useDatos, Cabecera, Cifra, Error } from '../componentes/comunes.jsx';
import Barras from '../componentes/Barras.jsx';
import { euros } from '../api.js';

const ETAPAS = ['nuevo', 'contactado', 'conversando', 'cita', 'asistio', 'vendido', 'perdido'];
const ETAPA = { nuevo: 'Nuevos', contactado: 'Contactados', conversando: 'Conversando', cita: 'Con cita', asistio: 'Vinieron', vendido: 'Compraron', perdido: 'Perdidos' };
const INTENCION = { aplazar: 'Aplaza («el mes que viene»…)', precio: 'Le parece caro', competencia_precio: 'Lo ha visto más barato', pensar: 'Lo tiene que pensar', duda_medica: 'Duda (dolor, riesgos…)', salud_personal: 'Cuenta algo de su salud', ocupado_ahora: 'Ahora no puede', reservar: 'Quiere cita', no_interesa: 'No le interesa', ya_hecho: 'Ya se lo hizo', baja: 'Pide la baja', queja: 'Queja', pregunta: 'Pregunta', evento: 'Tiene un evento', preferencia_horario: 'Prefiere un horario', acepta: 'Dice que sí', otro: 'Otras' };
const ORIGEN = { meta_formulario: 'Meta · formulario', meta_ctwa: 'Meta · clic a WhatsApp', web_whatsapp: 'Web (botón WhatsApp)', ghl: 'GHL', treatwell: 'Treatwell', telefono: 'Teléfono', recepcion: 'Recepción', google: 'Google', referido: 'Recomendación', otro: 'Otros' };
const CIERRE = { precio: 'Precio', no_interesa: 'No le interesa', competencia: 'Se lo hizo en otro sitio', sin_respuesta: 'No contestó', baja: 'Pidió la baja' };

export default function Repesca() {
  const { datos: d, error } = useDatos('/panel/repesca', { cadaMs: 60000 });
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const n = (arr, k, v) => Object.fromEntries(arr.map((x) => [x[k], Number(x[v])]));
  const etapas = n(d.embudo, 'etapa', 'n');
  const totalLeads = Object.values(etapas).reduce((a, b) => a + b, 0);
  const conCita = (etapas.cita || 0) + (etapas.asistio || 0) + (etapas.vendido || 0);
  const pres = n(d.presupuestos, 'estado', 'euros');
  const presN = n(d.presupuestos, 'estado', 'n');
  return (
    <>
      <Cabecera antetitulo="Leads, cancelaciones y presupuestos" titulo="Repesca" />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra etiqueta="Leads" valor={totalLeads} detalle={`${conCita} con cita (${totalLeads ? Math.round((conCita / totalLeads) * 100) : 0} %)`} />
        <Cifra etiqueta="Presupuestos aceptados" valor={euros(pres.aceptado)} detalle={`${presN.aceptado || 0} de ${Object.values(presN).reduce((a, b) => a + b, 0)}`} tono="oro" />
        <Cifra etiqueta="Presupuestos pendientes" valor={euros(pres.entregado)} detalle={`${presN.entregado || 0} en seguimiento`} />
        <Cifra etiqueta="Secuencias activas" valor={d.secuencias.filter((s) => s.estado === 'activa').reduce((a, s) => a + Number(s.n), 0)} detalle="se paran en cuanto el paciente contesta" />
      </section>
      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Barras titulo="Embudo de leads" filas={ETAPAS.filter((e) => etapas[e]).map((e) => ({ etiqueta: ETAPA[e], valor: etapas[e] }))} />
        <Barras titulo="Qué contestan los pacientes" filas={d.excusas.slice(0, 10).map((x) => ({ etiqueta: INTENCION[x.intencion] || x.intencion, valor: Number(x.n) }))} />
        <Barras titulo="De dónde vienen los leads" filas={d.origenes.map((x) => ({ etiqueta: ORIGEN[x.origen] || x.origen, valor: Number(x.leads) }))} />
        <Barras titulo="Ofertas hechas (del catálogo de la clínica)" filas={d.ofertas.filter((o) => Number(o.hechas)).map((o) => ({ etiqueta: o.nombre, valor: Number(o.hechas) }))} vacio="Aún no se ha hecho ninguna oferta" />
        <Barras titulo="Por qué se cierran" filas={d.cierres.filter((c) => c.motivo).map((c) => ({ etiqueta: CIERRE[c.motivo] || c.motivo, valor: Number(c.n) }))} vacio="Ninguna conversación cerrada todavía" />
      </section>
    </>
  );
}
