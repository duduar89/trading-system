# 6 · Puesta en marcha

## 6.1 Probarlo hoy, en cinco minutos

```bash
cd tarjeta-nfc
node servidor/semilla.js --demo      # crea empleados, premios y clientes falsos
npm start                            # http://localhost:8080/staff.html
```

La semilla imprime dos PIN por pantalla. Apúntalos: no se vuelven a mostrar.

En el portátil no hay NFC, así que el mostrador enseña el campo para teclear el
número de tarjeta a mano — sirve para ver el flujo entero sin hardware.

Para probarlo con NFC de verdad hace falta HTTPS ([`03`](03-hardware.md) §3.5) y
un Android.

---

## 6.2 Antes de comprar nada: tres decisiones

Media hora de conversación que ahorra meses.

**1 · ¿Cada cuánto viene un cliente habitual?**
De aquí sale el objetivo de sellos ([`02`](02-como-funcionan-los-puntos.md) §2.3).
Si no lo sabes, cuenta a ojo una semana. Equivocarse aquí es lo que mata el
programa.

**2 · ¿Cuál es el premio?**
Uno solo, que apetezca, que traiga otra visita y cuyo coste real conozcas. Hazte
la cuenta del §2.2 antes de decidirlo.

**3 · ¿Quién lo pide en el mostrador?**
Si nadie tiene el encargo explícito de decir *"¿tienes nuestra tarjeta?"*, no se
va a pedir. Esta es la decisión que más determina el resultado y la que más se
salta.

---

## 6.3 Piloto de dos semanas

**Semana 0 — montar**

- [ ] Compra 100 tarjetas NTAG213 blancas y numéralas a mano del 1 al 100.
- [ ] Un Android en la barra con soporte y cargador.
- [ ] Servidor con dominio y HTTPS ([`03`](03-hardware.md) §3.5).
- [ ] Ajusta `config.json`: `objetivo`, `importe_minimo_cents`, premio.
- [ ] `node servidor/semilla.js --pin-encargado XXXX --pin-mostrador YYYY` (sin `--demo`).
- [ ] Escribe las bases del programa y la política de privacidad ([`05`](05-seguridad-y-fraude.md) §5.6).
- [ ] Cartel pequeño en la barra. Sin cartel, no se apunta nadie.
- [ ] **Copia de seguridad programada** de `tarjetas.db`. Hazlo ahora, no después.

**Semanas 1–2 — rodar**

- [ ] Da de alta tú las diez primeras tarjetas, delante del equipo.
- [ ] No grabes todavía la URL en los chips: espera a confirmar el dominio.
- [ ] Mira `GET /api/metricas` cada día. Si `altas_30d` se queda plano dos días
      seguidos, el problema está en el mostrador, no en el sistema.

**Final de la semana 2 — decidir**

| Si ves… | Entonces |
|---|---|
| < 20 altas | no se está pidiendo. Habla con el equipo antes de tocar nada |
| altas bien, `taps/altas` < 1,5 | se apuntan y no vuelven a usarla: falta recordárselo al cobrar |
| todo bien, nadie llega al premio | el objetivo es demasiado alto: bájalo (§2.3) |
| todo bien y hay canjes | graba las URL en los chips y encarga las tarjetas impresas |

---

## 6.4 El guion del mostrador

Lo que se dice, literal, para que lo diga todo el equipo igual:

> **Al cobrar, a alguien nuevo:** *"¿Tienes nuestra tarjeta? Es gratis, a los
> diez cafés te invitamos al siguiente."*
>
> **Al darla:** *"Te apunto ya el primero."* — y se le da con un sello puesto.
> Una tarjeta que nace con uno se completa mucho más que una vacía.
>
> **A quien ya la tiene:** *"¿Me la acercas?"* — y se acerca al móvil.
>
> **Cuando el premio está cerca:** *"Te queda uno para el café gratis."*

---

## 6.5 Operación

**Cada día.** Nada. Ese es el objetivo.

**Cada mes.**
- Mirar métricas (§2.7).
- Revisar puntos por empleado ([`05`](05-seguridad-y-fraude.md) §5.4).
- `POST /api/caducar` — o mejor, un cron:
  ```
  0 4 1 * *  curl -s -X POST -H "Authorization: Bearer $TOKEN" https://…/api/caducar
  ```

**Copia de seguridad, a diario.**
```bash
sqlite3 tarjetas.db ".backup '/copias/tarjetas-$(date +%F).db'"
```
`.backup` es seguro con el servidor en marcha; copiar el fichero a pelo mientras
se escribe, no.

---

## 6.6 Incidencias habituales

| Pasa | Qué hacer |
|---|---|
| **Tarjeta perdida** | `POST /api/tarjetas/sustituir` con el UID de la nueva. El saldo va con el cliente; la vieja queda inservible |
| **El móvil no lee** | ¿NFC encendido? ¿La página va por `https://`? ¿Es un iPhone? ([`03`](03-hardware.md) §3.1) |
| **"Esta tarjeta ya sumó hace X min"** | es el antipassback. Si el cliente vino de verdad dos veces, lo fuerza el encargado |
| **"Límite de N por día"** | no se puede forzar, a propósito. Si toca dar más, se hace un `ajuste` ([`05`](05-seguridad-y-fraude.md) §5.3) |
| **Se cayó el wifi** | se apunta solo y se envía al volver. El contador de pendientes está debajo del lector |
| **Cliente que se va del equipo** | `UPDATE staff SET activo = 0 WHERE id = ?` y cambia los PIN |

---

## 6.7 Si el piloto va bien

Por orden de lo que más aporta por lo que menos cuesta:

1. **Grabar la URL en los chips** — el cliente consulta sus puntos con su móvil.
   Gratis, y es lo que más gusta ([`03`](03-hardware.md) §3.4).
2. **Tarjetas impresas** con tu marca, ya con volumen conocido.
3. **Avisar al que le falta uno.** Requiere consentimiento y algo que envíe SMS o
   email; es la palanca de recurrencia más eficaz que hay.
4. **Multiplicador en el día flojo** (§2.5).
5. **Integrar el TPV** para que el importe llegue solo, si te has pasado a puntos
   por euro.
6. **NTAG424** solo si de verdad quieres que el cliente sume sin empleado
   delante ([`05`](05-seguridad-y-fraude.md) §5.5).
