# 02 · Apuestas deportivas con enfoque de programador

[← Volver al informe](README.md) · Herramienta: [`herramientas/cuotas.py`](herramientas/cuotas.py)

Aquí no se trata de acertar resultados. Se trata de **matemáticas y operativa**: capturar subsidios (bonos) y precios mal puestos, midiendo todo.

**Todo lo de este documento es legal en España** si usas solo casas con licencia de la DGOJ, y [Betfair.es](https://www.betfair.es) como exchange (es el único autorizado).

**Resumen:**

| Estrategia | Capital | Realista | Límite principal | Nota |
|---|---|---|---|---|
| Matched betting (bonos) | 50–3.000 € | 1.600–2.400 € una vez + 150–300 €/mes | Cada bono se cobra una vez; exclusión de promociones | **7,5** |
| Value betting contra Pinnacle | 1–5 k€ | Yield del 2–4 % sobre lo apostado | Te limitan las cuentas | **6,5** |
| Herramientas para apostadores (SaaS) | 0–500 € | Sin datos para un independiente | Competencia ya asentada | **5,5** |
| Modelos propios en nichos | 0,5–2 k€ | Sin evidencia de que ganen al cierre | Sobreajuste, amaños | **4,5** |
| Bot en Betfair.es | ~600 € + banca | Decenas o pocos cientos de €/mes | Liquidez española muy pequeña | **4,5** |
| Surebets | 2–10 k€ | Cientos de €/mes durante poco tiempo | Te limitan antes que en value | **4** |

---

## 1. Matched betting de bonos · 7,5/10 · confianza alta

**Qué es.** Apuestas a favor en la casa, usando el bono (**back**), y cubres el mismo resultado apostando en contra en Betfair Exchange (**lay**). Ganas lo mismo pase lo que pase. Tiene dos fases:

1. **Bonos de bienvenida:** un único recorrido por 30–40 casas.
2. **Promociones recurrentes:** supercuotas, reembolsos, recargas y apuestas gratis por fidelidad.

**Por qué funciona.** Es un **subsidio de captación** enorme:

- Las casas gastaron [347,2 M€ en promociones en 2025](https://www.infoplay.info/es/2026-03-13/informe-anual-2025-el-juego-online-en-espana-crece-un-17-y-consolida-su-madurez-con-1700-millones-de-euros-en-ggr/35141/noticia/) (+32,7 %).
- Solo en el T2 de 2026 fueron [91,25 M€](https://sectordeljuego.com/2026/09/22/el-juego-online-en-espana-eleva-un-3116-su-ggr-en-el-segundo-trimestre-de-2026/), con unas 253.600 cuentas nuevas al mes.

No predices nada: pagas un 2 % de comisión en el exchange y te quedas el subsidio.

**Estado legal (verificado):**

- El Tribunal Supremo [anuló en abril de 2024](https://www.moncloa.com/2024/04/12/bonos-de-bienvenida-casinos-online-tribunal-supremo-2547884/) las restricciones a los bonos del RD 958/2020.
- Consumo ha intentado prohibirlos otra vez y [ha fracasado dos veces](https://www.elsemanaldelamancha.com/articulo/te-interesa/bonos-bienvenida-ministerio-consumo-fracasa-segundo-intento-prohibirlos/20260303113748243676.html), la última en marzo de 2026.
- **⚠️ Fecha límite.** El [RD 520/2026](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-13762) impone **límites conjuntos de depósito para todas las casas a la vez** desde el **25 de marzo de 2027**: 700 €/día, 1.750 €/semana y 3.300 € cada 4 semanas. Subir el límite tarda 3 días hábiles y no puedes volver a pedirlo hasta pasados 3 meses. **Adelanta los bonos grandes a antes de esa fecha.**

**Dinero realista:**

- **Bonos de bienvenida:** 1.600–2.400 € brutos, una sola vez ([NinjaBet](https://www.ninjabet.es/matched-betting-2025), [ZeroAzar](https://zeroazar.com/es-es)).
- **Recurrentes:** las plataformas prometen 200–600 €/mes. El único caso real documentado que encontramos ([Inversora con 30](https://inversoracon30.substack.com/p/que-con-es-el-matched-betting-mi)) suma 4.169 € en 2 años, unos 150–170 €/mes.
- **Neto tras IRPF** (base general): primer año ~1.000–1.700 € de bienvenida + 100–300 €/mes.
- No escala con más capital: escala con horas y con el número de promociones.

**Tu ventaja como programador.** No se trata de bots que apuesten: están prohibidos en las casas. La ventaja está en:

- un **registro contable** en Python/SQLite: casa, bono, back, lay, comisión y P&L, que te cuadra la renta;
- una **calculadora** propia de back/lay: [`cuotas.py matched`](herramientas/cuotas.py);
- leer **liquidez y cuotas lay** de Betfair.es por API con [betfairlightweight](https://github.com/betcode-org/betfair) (la clave diferida es gratis);
- un **rastreador de promociones** y de sus condiciones.

```bash
# Apuesta gratis de 25 € sin devolución del stake (SNR), back a 4.0 en la casa, lay a 4.2 en Betfair (2 %)
python3 herramientas/cuotas.py matched --back 4.0 --lay 4.2 --stake 25 --tipo freebet --comision 0.02
# -> +17,58 € pase lo que pase (conversión del 70 %)
```

**Riesgos.**

- Que prohíban los bonos (regulación).
- Que te excluyan de promociones.
- Errores al leer las condiciones.
- Liquidez insuficiente en el pool español de Betfair.

**Comunidades en español:** [ZeroAzar](https://zeroazar.com/es-es) (ruta gratuita y calculadora), [NinjaBet](https://www.ninjabet.es/matched-betting-2025), [Amigos del Matched Betting](https://amigosdelmatchedbetting.com/matched-betting-espana/), [apuestasigualadas.com](https://apuestasigualadas.com/).

---

## 2. Value betting contra el precio justo de Pinnacle · 6,5/10

**Qué es.** Un escáner compara las cuotas de las casas blandas con licencia en España (Bet365, Bwin, Codere, Sportium, Retabet…) con la probabilidad **sin margen** de la línea sharp (Pinnacle, o el consenso de muchas casas). Apuestas solo cuando la cuota blanda supera la justa por un margen, por ejemplo un 5 %.

```bash
python3 herramientas/cuotas.py ev --justas 2.10 3.40 3.60 --seleccion 0 --cuota 2.30 --banca 1000
# Probabilidad justa (Shin) 0,4587 -> EV +5,49 %; Kelly ×0,25 = 1,06 % de la banca
```

**Evidencia:**

- **[Kaunitz, Zhong y Kreiner](https://arxiv.org/abs/1710.02824):** 3,5 % de retorno en 56.435 apuestas simuladas y **+8,5 % con dinero real en 5 meses, hasta que los limitaron**. Código y datos: [BeatTheBookie](https://github.com/Lisandro79/BeatTheBookie).
- **[Buchdahl](https://www.football-data.co.uk/blog/pinnacle_efficiency.php):** con 87.960 pares de cuotas, la línea de cierre de Pinnacle es un estimador casi perfecto. **El CLV (valor frente al cierre) predice tu beneficio**, así que mide el CLV y no el P&L.
- **[RebelBetting, enero de 2025](https://www.rebelbetting.com/customer-results/value-betting-results-in-january-2025-a-strong-start-to-the-year):** CLV del 3,3 % y yield del 2,7 % en 373.654 apuestas de sus usuarios.

**Realista.** Yield del 2–4 % sobre lo apostado, mientras las cuentas duren (semanas o meses). No hay evidencia sólida de la media en España.

**Cosas importantes:**

- **Pinnacle no acepta residentes en España.** Solo sirve como fuente de precios.
- La API pública de Pinnacle **cerró en julio de 2025**. Hay sustitutos de pago como [pinnapi](https://pinnapi.com/) (99–229 $/mes).
- **No uses The Odds API como referencia sharp:** no cubre bien Pinnacle y te dará falsos valores.
- Apostar automáticamente en casas blandas va contra sus condiciones: ejecuta a mano.
- La limitación de cuentas es el cuello de botella real. Hay jurisprudencia española que [anula las cláusulas de limitación](https://www.iberley.es/jurisprudencia/sentencia-civil-audiencia-provincial-civil-n-1-24-10-25-48720363) (Audiencia Provincial de Ourense, octubre de 2025).
- **Nunca alquiles cuentas de terceros.**

**Pasos.**

1. Reproduce el backtest de Kaunitz con **cuotas ejecutables**, no con medias.
2. Monta el escáner.
3. Registra cada apuesta con la cuota de cierre para calcular el CLV.
4. Solo escala si el CLV es positivo tras más de 300 apuestas.

---

## 3. Bot en Betfair Exchange .es · 4,5/10

**Qué es.** Un bot con [flumine](https://github.com/betcode-org/flumine) que toma precio cuando Betfair.es se aleja del precio justo internacional, o que da liquidez alrededor de ese precio.

**Por qué podría funcionar.** La ley obliga a que los clientes españoles [solo se crucen entre ellos](https://www.apuestas-deportivas.es/casas-de-apuestas-espanolas/analisis-betfair-es). El pool español está aislado y sus precios pueden desviarse. Además es **el único sitio donde a un ganador no lo limitan**. A partir de 25.000 £ de beneficio se aplica una comisión adicional, el "Expert Fee".

**Pero la capacidad es muy pequeña.** Todo el exchange español movió unos [36,8 M€ en un trimestre](https://europer.net/sin-categoria/el-juego-online-rompe-la-barrera-de-los-500-millones-el-ggr-se-dispara-un-31-y-alcanza-los-539-millones-en-espana/).

**Coste.** La clave de API en vivo cuesta [499 £ de pago único](https://support.developer.betfair.com/hc/en-us/articles/115003864531-Are-there-any-costs-associated-with-API-access). La clave diferida es gratis.

**Pasos.** Graba el stream de los mercados .es durante 4–8 semanas con la clave gratuita **antes** de pagar nada, y mide liquidez, horquillas y la desviación frente a Pinnacle.

**Recursos:** [Betfair Automation Hub](https://betfair-datascientists.github.io/), [AwesomeBetfair](https://github.com/betfair-down-under/AwesomeBetfair), [foro de desarrolladores](https://forum.developer.betfair.com/).

## 4. Modelos propios en nichos (ligas menores, tenis ITF, eSports) · 4,5/10

Modelos Dixon-Coles o Poisson bivariante en fútbol, Elo o Glicko por superficie en tenis, ratings de mapas en eSports. Librerías: [penaltyblog](https://github.com/martineastwood/penaltyblog) y [goalmodel](https://github.com/opisthokonta/goalmodel).

**No hay evidencia de que un modelo propio público bata el cierre.** Trátalo como I+D y solo apuesta si tienes CLV positivo demostrado.

Ojo: el tenis ITF y los eSports tier 2 tienen **historial de amaños**. El que tiene información privilegiada eres el otro, no tú.

## 5. Surebets · 4/10

Un 1–5 % por operación. Pero el patrón es muy detectable y te limitan antes que en value betting, te anulan apuestas por "error de cuota" y tienes el capital repartido entre muchas casas. El "10–15 % mensual" que anuncian los escáneres es marketing.

**Úsalas solo para liberar los requisitos de apuesta de los bonos (rollover) con poca varianza.**

## 6. Vender herramientas a apostadores · 5,5/10

El que gana acaba limitado; el que vende la herramienta, no.

- **Precios de referencia:** [BetBurger](https://www.surebets.bet/es/reviews/betburger/) cobra 80–320 €/mes y RebelBetting 99–209 $/mes.
- **Hueco:** hay poca herramienta nativa en español centrada en las casas .es.
- **Fiscalidad:** es actividad económica (autónomo).
- **Límite legal:** no promociones casas sin licencia DGOJ, porque es infracción.

---

## Trampas

- **Métricas de "30 % de ROI al mes".** La métrica honesta es el yield sobre lo apostado (2–4 %) y el CLV.
- **Backtests con cuotas medias o de cierre** que no podías ejecutar.
- **Casas sin licencia DGOJ o "cripto sin límites".** No tienes ninguna protección.
- **Cursos de "trading deportivo", tipsters y martingalas.**
- **Olvidar Hacienda.** Las ganancias van a la base general. Las pérdidas del juego **solo compensan ganancias de juego del mismo año** y no pasan a años siguientes. Los operadores informan a la AEAT.
