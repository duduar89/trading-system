# 07 · Fiscalidad y marco legal en España (2026)

[← Volver al informe](README.md)

Esto no sustituye a un asesor fiscal. Es un mapa con fuentes para que sepas qué preguntar y qué automatizar.

**Por qué importa tanto.** Con estrategias de rentabilidad modesta, **la fiscalidad decide si ganas o no**:

- Un 6 % bruto tributado en la base general al 37 % se queda en un 3,8 %.
- El mismo 6 % en un fondo traspasado sigue componiendo entero.

---

## 1. En qué casilla cae cada cosa

| Actividad | Cómo tributa | Tipo | Fuente |
|---|---|---|---|
| Trading con tu capital: acciones, ETFs, futuros, opciones, **también con bots** | Ganancia patrimonial, **base del ahorro** | 19–30 % | [DGT V2232-25](https://www.cuatrecasas.com/es/spain/fiscalidad/art/criptomonedas-trading-automatico-actividad-economica) (24-nov-2025): operar con bots sobre patrimonio propio **no es actividad económica**, así que no tienes que ser autónomo |
| Fondos de inversión | Base del ahorro, **solo al reembolsar**. Los traspasos entre fondos no tributan | 19–30 % | [art. 94 LIRPF](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764) |
| Cripto: venta **y cada permuta** (incluida cripto → stablecoin) | Base del ahorro, método FIFO por activo | 19–30 % | V1604-18 ([PwC](https://periscopiofiscalylegal.pwc.es/la-agencia-tributaria-y-la-fiscalidad-de-las-criptomonedas/)) |
| Staking y préstamo de cripto | Rendimiento del capital mobiliario (criterio de la DGT) | 19–30 % | V1766-22 |
| Airdrops y recompensas (NMR, TAO…) | Tributan **al recibirlos**, por su valor en euros; al vender, ganancia o pérdida | variable | — |
| **Apuestas, matched betting, value betting, Betfair** | Ganancia patrimonial en la **base general**. Las pérdidas solo compensan **ganancias de juego del mismo año** | 19–47 % | [art. 33.5.d LIRPF](https://www.iberley.es/practicos/caso-practico-tributacion-irpf-las-ganancias-perdidas-apuestas-juegos-online-21201) |
| Premios de torneos (Metaculus, Kaggle, CrunchDAO) | Ganancia patrimonial en la base general | 19–47 % | — |
| Bug bounties, freelance, SaaS | **Actividad económica** (autónomo si hay habitualidad; IVA/OSS en ventas digitales a la UE) | 19–47 % + cuota | — |
| Pagos de prop firms | Actividad económica según la interpretación mayoritaria (no hay consulta vinculante específica) | 19–47 % + cuota de autónomo + IVA por inversión del sujeto pasivo | [Copilot Gestoría](https://copilotgestoria.com/blog/prop-firms-cuentas-fondeo-2026-fiscalidad-trader-capital-externo-gestorias-irpf-actividad-economica-dac8) |

**Tramos de la base del ahorro en 2026** ([AEAT](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c15-calculo-impuesto-determinacion-cuotas-integras/gravamen-aplicable-contribuyentes-irpf-residentes-extranjero/gravamen-base-liquidable-ahorro.html)):

| Tramo | Tipo |
|---|---|
| Hasta 6.000 € | 19 % |
| 6.000–50.000 € | 21 % |
| 50.000–200.000 € | 23 % |
| 200.000–300.000 € | 27 % |
| Más de 300.000 € | 30 % |

### Lo más útil de esta tabla para ti

1. **Si tu bot gana, que opere tu dinero, no el de una prop firm.** Con 30.000 € de beneficio pagarías unos 6.400 € en la base del ahorro. Como actividad económica, unos 9.000–11.000 € más la cuota de autónomo (cálculo orientativo).
2. **Las apuestas son la peor casilla**: base general y sin arrastre de pérdidas. Por eso el matched betting, que casi no tiene pérdidas, encaja mejor que el value betting, que tiene varianza.
3. **Los fondos traspasables son la mejor casilla** para cualquier estrategia de rotación a medio plazo.

## 2. Reglas que conviene programar

- **Compensación.** Las pérdidas patrimoniales compensan ganancias patrimoniales. Si sobra saldo negativo, compensa hasta el **25 %** de los rendimientos del capital mobiliario (y a la inversa). Lo que quede se arrastra **4 años** ([art. 49 LIRPF](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764)).
- **Regla de recompra de 2 meses.** En acciones y ETFs cotizados, si recompras valores homogéneos en los 2 meses anteriores o posteriores a la venta con pérdida, esa pérdida se difiere (art. 33.5.f).
- **Cripto.** La DGT dice que la regla de 2 meses no aplica, pero **el art. 33.5.e puede diferir la pérdida si recompras el mismo activo en menos de 1 año**. No vendas y recompres al momento.
- **Un motor fiscal propio (FIFO)** que calcule las plusvalías latentes y te avise en noviembre de qué pérdidas conviene realizar vale **miles de euros al año** con capital medio o alto. Referencia open source para cripto: [rotki](https://github.com/rotki/rotki). Con IBKR puedes exportar los extractos automáticamente con Flex Queries.

## 3. Obligaciones informativas

| Modelo | Cuándo | Nota |
|---|---|---|
| **720** | Más de 50.000 € en un bloque de bienes en el extranjero (por ejemplo, un bróker extranjero como IBKR) | El régimen sancionador se suavizó tras la sentencia del TJUE C-788/19, pero sigue habiendo multas por datos omitidos |
| **721** | Más de 50.000 € en cripto **custodiada** en el extranjero a 31 de diciembre | Las wallets propias no entran en el 721 |
| **172 / 173** | Los presentan los exchanges españoles (saldos y operaciones) | Tú no haces nada |
| **DAC8** | Desde el 1-ene-2026 los exchanges de la UE recogen tus datos; el primer envío a Hacienda es en 2027 | [Finbooks](https://finbooks.com/es/blog/dac8-crypto-reporting). Hacienda lo va a ver todo |

## 4. Regulación: dónde puedes operar

- **MiCA.** El periodo transitorio en España [terminó el 1-jul-2026](https://www.cnmv.es/portal/mica/regulacion-criptoactivos?lang=en). Solo pueden prestar servicios los proveedores autorizados:
  - con licencia española: Bit2Me y Criptan;
  - con pasaporte de la UE: Coinbase, Kraken, Crypto.com, Bitstamp o Bitpanda ([Guía Fiscal](https://guiafiscal.es/irpf/exchanges-cripto-regulados-espana-2026/)). Comprueba cada uno en el registro de ESMA y de la CNMV.
- **DeFi** (Aave, Hyperliquid…) queda fuera del perímetro de MiCA: no está prohibido para ti, pero tampoco tiene protección.
- **CFDs.** La CNMV y ESMA limitan el apalancamiento de los minoristas, obligan a la protección de saldo negativo y al cierre automático al 50 % del margen ([BOE 2019](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2019-9737)). Las opciones binarias están prohibidas.
- **PRIIPs.** Como minorista no puedes comprar ETFs domiciliados en EE. UU. Las acciones individuales, las opciones y los futuros no están afectados.
- **Cliente profesional MiFID.** Tienes que cumplir 2 de 3 requisitos: más de 10 operaciones significativas por trimestre durante 4 trimestres, cartera de más de 500 k€, o al menos 1 año trabajando en el sector ([FAQ de la CNMV](https://www.cnmv.es/docportal/Legislacion/FAQ/FAQ_MiFIDII.pdf)). A cambio pierdes protecciones, como la de saldo negativo. Rara vez compensa.
- **Asesorar o vender señales.** El asesoramiento personalizado y la gestión de carteras de terceros requieren autorización (EAF o ESI). Vender software genérico, no. En 2026 la CNMV ha [aumentado la presión sobre los finfluencers](https://www.cuatrecasas.com/es/spain/propiedad-intelectual/art/cnmv-publica-guia-finfluencers).
- **Juego.** Solo operadores con licencia de la DGOJ. Jugar con VPN en webs sin licencia es infracción leve (ver [doc 06](06-mercados-prediccion-y-vpn.md)). Desde el 25-mar-2027 se aplican los [límites de depósito conjuntos](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-13762) entre todas las casas.
- **Prop firms.** La CNMV avisa de que **quedan fuera de su supervisión**.

## 5. ¿Bróker español o extranjero?

| | Español | Extranjero (IBKR, etc.) |
|---|---|---|
| Retenciones | Te retiene el 19 % (dividendos, reembolsos de fondos) | No retiene en España |
| Borrador de la renta | Te trae los datos | Lo calculas tú |
| Modelo 720 | No aplica | Si superas 50 k€ |
| Doble imposición | Te la facilitan | La gestionas tú (W-8BEN: 15 % en EE. UU.) |
| Coste | Más caro | Suele ser más barato |

Para un perfil cuantitativo con muchas operaciones **suele compensar el extranjero si automatizas la contabilidad**.
