# IEMEC — app de gestión, repesca y reseñas para la clínica

Proyecto de Eduardo (Brainstormers) para IEMEC, Boadilla del Monte. Antes de hacer nada:

1. Leer `PROGRESO.md`: fase actual, lo hecho y las puertas ⛔ que esperan decisión.
2. El encargo completo, las reglas del loop y los criterios de salida están en `docs/ENCARGO.md`.

Reglas que no se saltan:

- **Repositorio público:** nunca credenciales, datos de pacientes, conversaciones reales ni
  informes comerciales para la clínica. Solo código y datos públicos de su web.
- **Integraciones detrás de adaptadores con modo simulado.** Las pruebas nunca llaman a servicios
  reales.
- **Todo en español**, como CIFRA y El Método. CommonJS en el servidor.
- **Sin temporizadores en la app:** cron cada minuto + cola en MariaDB con `SKIP LOCKED`.
- **Legal:** nada de publicidad de medicamentos con receta (toxina botulínica, semaglutida,
  tirzepatida…) ni descuentos ligados a ellos; la IA nunca da consejo médico y se presenta como
  asistente virtual.
- Cada iteración termina con pruebas en verde, `PROGRESO.md` actualizado y un commit.
