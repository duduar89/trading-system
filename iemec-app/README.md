# IEMEC · agenda, repesca y reseñas

App para IEMEC (Instituto Europeo de Medicina Estética y Capilar, Boadilla del Monte):

- **Agenda por cabina** con profesionales, aparatos, limpiezas y comidas garantizadas. Cada
  tratamiento, en su sala.
- **La cita llega al paciente** por WhatsApp con su página «Tu cita» para añadirla al calendario
  (Google, Apple, Outlook), confirmarla, cambiarla o cancelarla.
- **Repesca** de leads, cancelaciones y presupuestos: la IA entiende las excusas, la fecha la pone el
  código y ninguna conversación se queda sin próximo paso.
- **Plantillas de WhatsApp** con filtro de publicidad sanitaria.
- **Reseñas de Google** pedidas a todos tras la cita, con respuestas que aprueba una persona.
- **Panel** con la estética de la clínica (terciopelo), PWA para tablet y móvil.

Stack: Node 22 + Express 5 + MariaDB, React + Vite + Tailwind. Integraciones (WhatsApp, Claude,
Google) detrás de adaptadores con modo simulado.

- Empezar en el portátil y subir a cPanel: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)
- El encargo y las fases: [`docs/ENCARGO.md`](docs/ENCARGO.md)
- Por dónde vamos: [`PROGRESO.md`](PROGRESO.md)

```bash
npm install && npm run preparar-bd && npm test
node scripts/demo.js && npm run build && MODO_DEMO=1 npm start   # http://localhost:3004
```
