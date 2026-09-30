# IEMEC · agenda, repesca y reseñas

App para IEMEC (Instituto Europeo de Medicina Estética y Capilar, Boadilla del Monte):

- **Agenda por cabina** con profesionales, aparatos, limpiezas y comidas garantizadas. Cada
  tratamiento, en su sala.
- **La cita llega al paciente:** elige hueco por WhatsApp («la primera me va genial»), queda
  reservada y le llega su página «Tu cita» para añadirla al calendario (Google, Apple, Outlook),
  confirmarla o cancelarla. Recordatorios la víspera y 2 horas antes.
- **Repesca** de leads, cancelaciones y presupuestos: la IA entiende las excusas, la fecha la pone el
  código y ninguna conversación se queda sin próximo paso.
- **Plantillas de WhatsApp** con filtro de publicidad sanitaria.
- **Reseñas de Google** pedidas a todos tras la cita, con respuestas que aprueba una persona, y las
  normas de Google (texto fuera a los 29 días, alerta clínica). Posiciones en Maps con DataForSEO.
  Guía de accesos: [`docs/GOOGLE.md`](docs/GOOGLE.md).
- **Panel** con la estética de la clínica (terciopelo), PWA para tablet y móvil. El personal entra con
  passkeys, cada persona con su rol (`npm run invitar` da el primer enlace de alta).
- **Importador de Flowww** (`scripts/importar-flowww.js`): pacientes y citas futuras, con ensayo y
  deshacer, para apagarlo sin perder nada. Guía en [`docs/MIGRAR-FLOWWW.md`](docs/MIGRAR-FLOWWW.md).

Stack: Node 22 + Express 5 + MariaDB, React + Vite + Tailwind. Integraciones (WhatsApp, Claude,
Google) detrás de adaptadores con modo simulado.

- Empezar en el portátil y subir a cPanel: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)
- El encargo y las fases: [`docs/ENCARGO.md`](docs/ENCARGO.md)
- Por dónde vamos: [`PROGRESO.md`](PROGRESO.md)

```bash
npm install && npm run preparar-bd && npm test
node scripts/demo.js && npm run build && MODO_DEMO=1 npm start   # http://localhost:3004
```
