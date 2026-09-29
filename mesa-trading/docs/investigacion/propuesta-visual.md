# Réplica visual — especificación de la pantalla «Parqué»

Referencias: las dos capturas que mandó Eduardo (oficina isométrica pixel-art en
localhost:8765 y la versión 3D morada con tarjeta de detalle por setup).

## 0. Qué hay en las dos imágenes

**Imagen 1 (pixel-art isométrico):** barra superior oscura con PATRIMONIO
99.999 $, RESULTADO HOY −1 $ (−0,00 %), CAÍDA 0,00 %, EXPOSICIÓN 0 % bruta,
POSICIONES 0, y píldoras RISK-ON (verde), F&G 70 · Codicia, «Comité en 17:08»,
PAPEL (ámbar). Panel izquierdo «Departamentos» con pestañas (Macro…) y feed de
mensajes con hora. Suelo isométrico en rombo: parqué gris claro con muchas
mesas pequeñas (cada una con monitor verde/rojo y un muñeco), paneles de
cotizaciones en la pared y una pantalla con el patrimonio y una curva roja.
Salas a la derecha: despacho con estanterías, sala lila, sala verde, zona de
sofás azules y máquina expendedora abajo, mesa de madera arriba a la derecha.
Bocadillos blancos («Sin posición en SOL. Esperando a que SMA 7-25 LONG
+Filtro200 SOL 4H dé señal», «Pausa de cinco minutos», «Nota de análisis ETH:
sesgo muy alcista…»). Botonera abajo: Comité, Megáfono, Prueba, Pausar todo,
Reabrir, Kill switch (rojo), Ajustes, y flechas de cámara.

**Imagen 2 (3D morado):** filas largas de mesas blancas; etiquetas flotantes
por activo (ADA, ETH, BTC, SOL, DOGE…); zona MACRO elevada; pantalla grande con
«$15.216,54 +$125,13» y curva; registro «hechos de la mesa»; tarjeta de detalle
de un setup: Situación (comprado), Nocional, Cantidad, Entrada, Stop, Objetivo,
Abierto, P&L del día, Trades, Acierto, Adherencia, Factor.

## 1. Estructura (1440×900)

```
┌──────────────── BARRA SUPERIOR (56 px) ─────────────────┐
├──────────┬──────────────────────────────────────────────┤
│ PANEL    │            LIENZO ISOMÉTRICO                  │
│ LATERAL  │                                               │
│ 300 px   │                                               │
├──────────┴──────── BOTONERA (48 px) ────────────────────┤
```
Fondo #0f1424. Tipografía system-ui; cifras con `font-variant-numeric: tabular-nums`.

## 2. Barra superior

PATRIMONIO, RESULTADO HOY (verde/rojo), CAÍDA, EXPOSICIÓN bruta y cripto,
POSICIONES. Píldoras: RÉGIMEN (RISK-ON verde, NEUTRAL gris, RISK-OFF rojo),
F&G con valor y etiqueta (color de rojo a verde), «Comité en HH:MM», MODO
(PAPEL ALPACA ámbar / SIMULADO azul / SINTÉTICO lila), LLM «0,12 $ / 1 $».

## 3. Panel lateral

Título «Departamentos»; chips de filtro (Todos, Dirección, Macro, Análisis,
Mesas, Riesgos, Operaciones, Laboratorio, Megáfono) con punto de color. Feed:
avatar circular del color del departamento, nombre en negrita, hora a la
derecha, texto 12 px. Lo último abajo; autoscroll salvo si el usuario ha
subido; máximo 300 en el DOM. Mensajes del Megáfono resaltados.

## 4. Lienzo isométrico

### 4.1 Proyección
Rejilla 2:1, tesela 64×32 px a zoom 1:
```
x = (col − fila) × 32 + origenX
y = (col + fila) × 16 + origenY
```
Orden de pintado: suelo → paredes traseras → objetos y personajes ordenados
por (col + fila) → paredes frontales translúcidas → bocadillos. Zoom 0,5×–2×
con rueda o pellizco; paneo arrastrando.

### 4.2 Plano (28 × 22 teselas)
```
col →  0         10        20       28
     ┌─────────────────────┬──────────┐
  0  │ PANTALLA GIGANTE    │ DIRECCIÓN│
     │ + cotizaciones      │          │
  4  │                     ├──────────┤
     │   PARQUÉ PRINCIPAL  │ MACRO    │
     │   (mesas en filas)  │ (elevada)│
 10  │                     ├──────────┤
     │                     │ ANÁLISIS │
 14  │                     ├──────────┤
     │                     │ LABORAT. │
 16  ├──────────┬──────────┼──────────┤
     │ RIESGOS  │ SALA DE  │ DESCANSO │
     │ + OPER.  │ COMITÉ   │ sofás +  │
     │          │          │ máquina  │
 22  └──────────┴──────────┴──────────┘
```
Suelos: parqué #d9dde6, dirección madera #c9a27a, macro lila #cdb8f0,
análisis verde #bfe3c8, laboratorio cian #bfe7ec, riesgos #f1c9c9, comité
madera #b98b5e, descanso #f3e3c2. Paredes #2b3350 / #3a4466, altura 1,5 teselas.

### 4.3 Mesas del parqué
Cada puesto ocupa 2×1 teselas: tablero blanco, 1–2 monitores, silla, muñeco.
Una fila por mesa (familia), pasillos entre filas. Máximo 24 puestos.
Etiqueta flotante del activo. Monitor: verde con P&L abierto > +0,1 %, rojo
< −0,1 %, gris sin posición, ámbar parpadeando 2 s al enviar una orden, rojo
intenso tras un veto. Minicurva de 8 px con los últimos 16 cierres.

### 4.4 Pantalla gigante
En la pared del fondo del parqué, 8 teselas de ancho. Izquierda: tabla de
cotizaciones. Centro: patrimonio grande, resultado de hoy y curva con línea
discontinua en el patrimonio inicial. Derecha: «Hechos de la mesa», últimas 6
ejecuciones. Se dibuja en un canvas fuera de pantalla solo cuando llegan datos.

### 4.5 Personajes
Sprite de 12×24 px: cabeza (tonos de piel variados), cuerpo del color del
departamento, pies. Ciclo de 4 fotogramas. Estados: sentado (tecleo), andando
(por puertas entre salas), de pie en comité, en descanso (sofá o máquina),
anillo si está seleccionado. Velocidad 2 teselas/s. Solo se mueven por
eventos reales: comité (los jefes van a la sala), descanso cuando no tienen
trabajo, kill switch (todos de pie, pantalla en rojo).

### 4.6 Bocadillos
Máximo 40 caracteres por línea, 3 líneas, fondo blanco, 11 px. Duración
6 s + 60 ms por carácter, máximo 12 s. Máximo 5 a la vez, prioridad por importancia.

## 5. Tarjeta de detalle
Clic en un personaje o puesto: tarjeta de 280 px anclada abajo a la derecha
(no modal). Para puestos: mesa, estrategia, situación, nocional, cantidad,
entrada, stop (con distancia), objetivo, abierto, P&L del día, operaciones,
acierto, adherencia, factor, minicurva y último mensaje. Para otros agentes:
rol, qué decide, si usa LLM, último mensaje y estado.

## 6. Botonera
Comité, Megáfono (modal), Prueba (con confirmación para la orden mínima),
Pausar todo, Reabrir (escribir REABRIR), Kill switch (rojo, escribir KILL),
Ajustes (modal: modo, límites solo lectura, presupuesto LLM, modelos,
velocidad). A la derecha: controles de cámara y zoom.

## 7. Qué alimenta cada elemento
Evento `estado` (cada 2 s) → barra superior, pantalla gigante, monitores,
tarjeta. `mensaje` → feed y bocadillo. `agente` → movimiento. `ejecucion` →
monitor ámbar y hechos de la mesa. Al conectar, `GET /api/estado`.
Reconexión SSE con espera creciente y franja «sin conexión».

## 8. Rendimiento
requestAnimationFrame con tope de 30 fps; capa estática (suelos, paredes,
muebles) en un canvas fuera de pantalla que solo se repinta al cambiar zoom o
paneo; pantalla gigante en otro canvas fuera de pantalla. Pausa con la
pestaña oculta. Respetar devicePixelRatio.

## 9. Móvil (< 768 px)
Barra superior compacta con tres cifras; panel lateral como hoja inferior;
lienzo a pantalla completa con pellizco; tarjeta de detalle a pantalla
completa; botonera compacta con desplazamiento horizontal.

## 10. Paleta
Fondo #0f1424, panel #151b2e, borde #232b45, texto #e6e9f2, secundario
#8a93b0, positivo #22c55e, negativo #ef4444, aviso #f59e0b, lila #8b5cf6,
azul #3b82f6. Departamentos: los de `ARQUITECTURA.md §6.1`.

## 11. Cifras
Cuentan hacia arriba (500 ms, ease-out, sin rebote); barras crecen desde la
base; `prefers-reduced-motion` salta al valor final.

## Lo que no se hace
Ni Three.js ni Chart.js; nada de personajes que se mueven sin motivo; ningún
número inventado por un LLM; la tarjeta no bloquea la pantalla; nada de
auto-zoom.
