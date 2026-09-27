/**
 * Facturas «unseen»: 12 facturas de proveedor españolas realistas, distintas de public/samples y de tests/fixtures.
 * Cada una ejercita rasgos que el parser no había visto: órdenes de columnas nuevos, varias páginas con «Suma y sigue»,
 * tickets térmicos, albaranes valorados, descripciones en dos filas, lotes y zonas FAO, abonos, envases retornables,
 * precios de 3–4 decimales, separadores de miles, desgloses de IVA 4/10/21, letra de 8 px, formato apaisado…
 *
 * La verdad de referencia (expected.json) se genera de los MISMOS datos con que se imprime el HTML.
 */
import { cif, computeTotals, descText, esc, fmt, invoiceExpected, nif, r2 } from './helpers.mjs';

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #1d1d1f; }
  table { border-collapse: collapse; }
  .r { text-align: right; } .c { text-align: center; } .b { font-weight: 700; }
  .muted { color: #555; }
`;

function doc(title, css, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}

const dateEs = (iso, sep = '/') => {
  const [y, m, d] = iso.split('-');
  return `${d}${sep}${m}${sep}${y}`;
};
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dateLong = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} de ${MONTHS[Number(m) - 1]} de ${y}`;
};

// ───────────────────────────── 01 · Ultramarinos: 39 líneas en 2 páginas con «Suma y sigue» ─────────────────────────────

function inv01() {
  const supplier = { name: 'Ultramarinos y Distribuciones Levante S.L.', cif: cif('B', '9628741') };
  const customer = { name: 'Restaurante La Alacena S.L.', cif: cif('B', '9811350') };
  const number = 'FL-2026/004871';
  const date = '2026-09-17';
  const L = (code, desc, qty, price, vat, dto) => ({ code, desc, qty, price, vat, dto, unit: 'ud' });
  const lines = [
    L('100231', 'ACEITE OLIVA VIRGEN EXTRA GARRAFA 5L', 6, 38.9, 4, 3),
    L('100245', 'ACEITE GIRASOL ALTO OLEICO 10L', 2, 24.75, 4),
    L('110012', 'ARROZ BOMBA D.O. VALENCIA 1KG', 10, 4.15, 4),
    L('110020', 'ARROZ REDONDO SACO 5KG', 4, 7.2, 4),
    L('120003', 'HARINA DE TRIGO T-45 SACO 25KG', 1, 17.8, 4),
    L('120010', 'PAN RALLADO 1KG', 3, 1.95, 4),
    L('130101', 'AZÚCAR BLANCO 1KG', 10, 1.19, 10),
    L('130115', 'SAL MARINA GRUESA 1KG', 6, 0.58, 10),
    L('140220', 'GARBANZO PEDROSILLANO 1KG', 5, 3.4, 4),
    L('140225', 'LENTEJA PARDINA 1KG', 5, 2.85, 4),
    L('140230', 'ALUBIA BLANCA 1KG', 3, 3.1, 4),
    L('150301', 'TOMATE TRITURADO LATA 5KG', 6, 6.35, 10, 5),
    L('150310', 'TOMATE FRITO BRIK 2KG', 4, 4.9, 10),
    L('150402', 'PIMIENTO DEL PIQUILLO LATA 3KG', 2, 16.4, 10),
    L('160110', 'ATÚN CLARO EN ACEITE LATA 1KG', 4, 12.95, 10),
    L('160125', 'ANCHOA CANTÁBRICO 00 LATA 500G', 2, 29.5, 10),
    L('170001', 'VINAGRE DE JEREZ 1L', 3, 4.25, 10),
    L('170010', 'VINAGRE BALSÁMICO MÓDENA 500ML', 2, 3.6, 10),
    L('180020', 'PIMENTÓN DE LA VERA DULCE 750G', 1, 11.2, 10),
    L('180025', 'COMINO MOLIDO 500G', 1, 6.8, 10),
    L('180031', 'PIMIENTA NEGRA GRANO 1KG', 1, 18.9, 10),
    L('180040', 'AZAFRÁN EN HEBRA 5G', 2, 14.5, 10),
    L('180052', 'LAUREL HOJA 100G', 2, 2.1, 10),
    L('190101', 'CALDO DE PESCADO BRIK 1L', 12, 1.65, 10),
    L('190110', 'CALDO DE POLLO BRIK 1L', 12, 1.45, 10),
    L('200015', 'MAYONESA CUBO 3,6KG', 2, 9.8, 10),
    L('200020', 'KETCHUP DOSIFICADOR 1,8KG', 2, 6.15, 10),
    L('200030', 'MOSTAZA DIJON 1KG', 1, 5.9, 10),
    L('210001', 'CHOCOLATE COBERTURA 70% 1KG', 2, 12.4, 10),
    L('210012', 'LEVADURA FRESCA 500G', 2, 2.35, 4),
    L('220105', 'NUECES PELADAS 1KG', 1, 13.6, 10),
    L('220110', 'ALMENDRA MARCONA CRUDA 1KG', 1, 16.9, 10),
    L('230002', 'CAFÉ GRANO NATURAL 1KG', 6, 15.8, 10, 10),
    L('230010', 'AZÚCAR SOBRES 1000 UDS', 2, 9.95, 10),
    L('240001', 'SERVILLETA PAPEL 40X40 2C 1200 UDS', 2, 21.3, 21),
    L('240010', 'FILM TRANSPARENTE 300M', 3, 8.45, 21),
    L('240020', 'PAPEL ALUMINIO 200M', 2, 11.9, 21),
    L('250001', 'LAVAVAJILLAS MÁQUINA 20L', 1, 34.5, 21, 5),
    L('250010', 'ABRILLANTADOR MÁQUINA 10L', 1, 22.8, 21),
  ];
  const totals = computeTotals(lines);
  const split = 24;
  const carried = lines.slice(0, split).reduce((s, l) => s + l.total, 0);
  const row = (l) =>
    `<tr><td>${l.code}</td><td>${esc(l.desc)}</td><td class="r">${fmt(l.qty, 0)}</td><td class="r">${fmt(l.price, 2)}</td><td class="r">${l.dto ? fmt(l.dto, 2) : ''}</td><td class="r">${fmt(l.total, 2)}</td><td class="c">${l.vat}</td></tr>`;
  const thead = `<thead><tr><th style="width:62px">Código</th><th>Descripción</th><th class="r" style="width:48px">Cant.</th><th class="r" style="width:64px">Precio</th><th class="r" style="width:48px">Dto.%</th><th class="r" style="width:74px">Importe</th><th class="c" style="width:40px">IVA%</th></tr></thead>`;
  const header = `
    <div class="top">
      <div><div class="logo">UDL</div><div class="sname">${supplier.name}</div>
        <div class="muted">Pol. Ind. Fuente del Jarro · C/ Ciudad de Sevilla, 44 · 46988 Paterna (Valencia)</div>
        <div class="muted">CIF ${supplier.cif} · Tel. 961 340 572 · pedidos@udlevante.es</div></div>
      <div class="box"><div class="t">FACTURA</div>
        <table class="kv"><tr><td>Nº Factura</td><td class="b">${number}</td></tr><tr><td>Fecha</td><td>${dateEs(date)}</td></tr><tr><td>Cód. cliente</td><td>C-08812</td></tr><tr><td>Página</td><td>1 de 2</td></tr></table></div>
    </div>
    <div class="cust"><div class="lbl">CLIENTE</div><div class="b">${customer.name}</div><div>C/ Pintor Sorolla, 18 · 46002 Valencia</div><div>NIF ${customer.cif}</div></div>`;
  const vatTable = `<table class="vat"><tr><th>Tipo IVA</th><th class="r">Base imponible</th><th class="r">Cuota IVA</th></tr>${totals.breakdown
    .map((b) => `<tr><td>${b.rate} %</td><td class="r">${fmt(b.base)}</td><td class="r">${fmt(b.vat)}</td></tr>`)
    .join('')}</table>`;
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'Liberation Sans', Arial, sans-serif; font-size: 10.5px; }
     .page { width: 190mm; height: 275mm; padding: 4mm 2mm; position: relative; page-break-after: always; }
     .page:last-child { page-break-after: auto; }
     .top { display: flex; justify-content: space-between; align-items: flex-start; }
     .logo { display: inline-block; background: #0b5394; color: #fff; font-weight: 700; font-size: 18px; padding: 4px 10px; letter-spacing: 2px; margin-bottom: 4px; }
     .sname { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
     .box { border: 1.5px solid #0b5394; padding: 6px 10px; min-width: 210px; }
     .box .t { font-size: 17px; font-weight: 700; color: #0b5394; margin-bottom: 4px; }
     .kv td { padding: 1px 8px 1px 0; }
     .cust { margin: 10px 0 10px 98mm; border: 1px solid #aaa; padding: 6px 10px; }
     .lbl { font-size: 9px; color: #0b5394; font-weight: 700; }
     table.lines { width: 100%; }
     table.lines th { background: #0b5394; color: #fff; padding: 4px 5px; text-align: left; font-weight: 700; }
     table.lines td { padding: 2.6px 5px; border-bottom: 1px solid #e3e8ef; }
     .sigue td { border-top: 1.5px solid #333; font-weight: 700; }
     .mini { display: flex; justify-content: space-between; border-bottom: 1.5px solid #0b5394; padding-bottom: 4px; margin-bottom: 8px; }
     .foot { position: absolute; bottom: 2mm; left: 2mm; right: 2mm; font-size: 8px; color: #666; border-top: 1px solid #ccc; padding-top: 3px; }
     .tot { display: flex; justify-content: space-between; margin-top: 14px; }
     table.vat th { background: #e8eef7; padding: 3px 8px; text-align: left; } table.vat td { padding: 3px 8px; border-bottom: 1px solid #ddd; }
     table.sum td { padding: 3px 10px; } table.sum .grand td { font-size: 14px; font-weight: 700; border-top: 2px solid #0b5394; }`,
    `<div class="page">${header}
      <table class="lines">${thead}<tbody>${lines.slice(0, split).map(row).join('')}
        <tr class="sigue"><td></td><td colspan="4" class="r">SUMA Y SIGUE</td><td class="r">${fmt(carried)}</td><td></td></tr></tbody></table>
      <div class="foot">${supplier.name} · Inscrita en el Registro Mercantil de Valencia, Tomo 9.812, Libro 7.093, Folio 114, Hoja V-155.321 · Página 1 de 2</div>
    </div>
    <div class="page">
      <div class="mini"><span class="b">${supplier.name}</span><span>Factura ${number} · ${dateEs(date)} · Página 2 de 2</span></div>
      <table class="lines">${thead}<tbody><tr class="sigue"><td></td><td colspan="4" class="r">SUMA ANTERIOR</td><td class="r">${fmt(carried)}</td><td></td></tr>
        ${lines.slice(split).map(row).join('')}</tbody></table>
      <div class="tot">${vatTable}
        <table class="sum"><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)}</td></tr><tr><td>Total IVA</td><td class="r">${fmt(totals.vatTotal)}</td></tr><tr class="grand"><td>TOTAL FACTURA</td><td class="r">${fmt(totals.total)} €</td></tr></table></div>
      <p style="margin-top:14px">Forma de pago: recibo domiciliado a 30 días · IBAN ES91 2100 0418 4502 0005 1332</p>
      <div class="foot">${supplier.name} · Inscrita en el Registro Mercantil de Valencia, Tomo 9.812, Libro 7.093, Folio 114, Hoja V-155.321 · Página 2 de 2</div>
    </div>`,
  );
  return {
    id: 'inv01-ultramarinos-2-paginas',
    features: ['39 líneas en 2 páginas', 'Suma y sigue / Suma anterior', 'IVA por línea (%)', 'desglose 4/10/21', 'cabecera repetida en la página 2'],
    page: { format: 'A4', margin: '10mm' },
    html,
    expected: invoiceExpected({ id: 'inv01', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 02 · Carnicería: Uds + Kilos + lotes; CIF del cliente antes que el del proveedor ─────────────────────────────

function inv02() {
  const supplier = { name: 'Cárnicas Hermanos Ortega S.A.', cif: cif('A', '4518227') };
  const customer = { name: 'Asador El Encinar S.L.', cif: cif('B', '0544216') };
  const number = 'CHO/26/11873';
  const date = '2026-09-19';
  const L = (code, desc, pcs, qty, price, dto, lot) => ({ code, desc, pcs, qty, price, dto, lot, vat: 10, unit: 'kg' });
  const lines = [
    L('3001', 'SOLOMILLO DE TERNERA', 2, 4.38, 32.5, 0, '260915-03'),
    L('3005', 'ENTRECOT DE VACA MADURADA', 3, 6.215, 27.9, 5, '260910-11'),
    L('3012', 'CARRILLERA DE CERDO IBÉRICO', 12, 3.96, 10.4, 0, '260916-02'),
    L('3020', 'SECRETO IBÉRICO', 6, 2.845, 17.25, 0, '260916-05'),
    L('3031', 'PECHUGA DE POLLO FILETEADA', 1, 5, 7.15, 0, '260917-01'),
    L('3040', 'PIERNA DE CORDERO LECHAL', 4, 5.47, 21.8, 0, '260914-07'),
    L('3052', 'CHORIZO FRESCO PARRILLA', 2, 2.3, 8.95, 0, '260915-09'),
    L('3060', 'HAMBURGUESA VACUNO 180G', 24, 4.32, 11.6, 3, '260917-04'),
    L('3071', 'MORCILLA DE BURGOS', 5, 1.75, 7.8, 0, '260912-06'),
  ];
  const totals = computeTotals(lines);
  const rows = lines
    .map(
      (l) =>
        `<tr class="main"><td>${l.code}</td><td>${esc(l.desc)}</td><td class="r">${l.pcs}</td><td class="r">${fmt(l.qty, 3)}</td><td class="r">${fmt(l.price, 2)}</td><td class="r">${l.dto ? fmt(l.dto, 1) : ''}</td><td class="r">${fmt(l.total)}</td><td class="c">${l.vat}%</td></tr>
         <tr class="lot"><td></td><td colspan="7">Lote: ${l.lot} &nbsp; Cad.: ${dateEs('2026-10-0' + ((Number(l.code) % 7) + 1))} &nbsp; Origen: España</td></tr>`,
    )
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'DejaVu Sans', Verdana, sans-serif; font-size: 9.5px; }
     .hdr { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
     .cli { border: 1px solid #333; padding: 8px 10px; }
     .cli .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #7a1f1f; font-weight: 700; margin-bottom: 3px; }
     .brand { text-align: right; }
     .brand .n { font-size: 16px; font-weight: 700; color: #7a1f1f; }
     .meta { margin: 14px 0 8px; display: flex; gap: 28px; font-size: 10px; }
     .meta b { color: #7a1f1f; }
     table.lines { width: 100%; }
     table.lines th { border-top: 2px solid #7a1f1f; border-bottom: 2px solid #7a1f1f; padding: 4px; text-align: left; }
     table.lines td { padding: 2px 4px; }
     tr.lot td { font-size: 8px; color: #555; padding-bottom: 5px; border-bottom: 1px dotted #bbb; }
     .totals { margin-top: 16px; margin-left: auto; width: 60%; border: 1px solid #7a1f1f; }
     .totals th { background: #7a1f1f; color: #fff; padding: 4px; } .totals td { padding: 5px 4px; text-align: center; font-size: 11px; }
     .legal { margin-top: 30px; font-size: 7.5px; color: #555; border-top: 1px solid #ccc; padding-top: 4px; }`,
    `<div class="hdr">
       <div class="cli"><div class="lbl">Datos del cliente</div><div class="b">${customer.name}</div><div>Ctra. de El Escorial, km 3,2</div><div>28260 Galapagar (Madrid)</div><div>NIF: ${customer.cif}</div></div>
       <div class="brand"><div class="n">${supplier.name}</div><div>Mercado Central de Carnes, naves 14-16</div><div>28053 Madrid</div><div>Tel. 917 850 320 · www.carnicasortega.es</div><div>Reg. Sanitario ES 10.012345/M CE</div></div>
     </div>
     <div class="meta"><div><b>FACTURA Nº</b> ${number}</div><div><b>FECHA</b> ${dateEs(date)}</div><div><b>ALBARÁN</b> 26-7741</div><div><b>RUTA</b> 04</div></div>
     <table class="lines"><thead><tr><th>Código</th><th>Descripción</th><th class="r">Uds</th><th class="r">Kilos</th><th class="r">Precio</th><th class="r">Dto</th><th class="r">Importe</th><th class="c">IVA</th></tr></thead><tbody>${rows}</tbody></table>
     <table class="totals"><tr><th>Base imponible</th><th>% IVA</th><th>Cuota IVA</th><th>Total factura</th></tr>
       <tr><td>${fmt(totals.subtotal)}</td><td>10,00</td><td>${fmt(totals.vatTotal)}</td><td class="b">${fmt(totals.total)} €</td></tr></table>
     <div class="legal">${supplier.name} · CIF ${supplier.cif} · Inscrita en el R.M. de Madrid, Tomo 21.450, Folio 88, Sección 8, Hoja M-381.207 · Vencimiento: transferencia a 15 días</div>`,
  );
  return {
    id: 'inv02-carniceria-uds-kilos-lotes',
    features: ['Código | Descripción | Uds | Kilos | Precio | Dto | Importe | IVA', 'sublíneas de lote y caducidad', 'CIF del cliente antes que el del proveedor', 'CIF del proveedor sólo en el pie', 'pesos con 3 decimales'],
    page: { format: 'A4', margin: '12mm' },
    html,
    expected: invoiceExpected({ id: 'inv02', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 03 · Pescados: especie + zona FAO, pesos con 3 decimales ─────────────────────────────

function inv03() {
  const supplier = { name: 'Pescados y Mariscos del Cantábrico S.L.', cif: cif('B', '3960518') };
  const number = 'PMC/26/1187';
  const date = '2026-09-22';
  const L = (desc, qty, unit, price, sci, fao, arte) => ({ desc, qty, unit, price, sci, fao, arte, vat: 10 });
  const lines = [
    L('MERLUZA DEL PINCHO ENTERA', 4.235, 'kg', 16.9, 'Merluccius merluccius', '27.VIII.c', 'Anzuelo'),
    L('RAPE NEGRO COLA', 3.18, 'kg', 24.5, 'Lophius budegassa', '27.VIII.b', 'Enmalle'),
    L('LUBINA DE ESTERO 600/800', 2.96, 'kg', 13.75, 'Dicentrarchus labrax', 'Acuicultura · España', 'Criada en estero'),
    L('PULPO COCIDO PATA', 2, 'kg', 28.4, 'Octopus vulgaris', '34.1.1', 'Nasas'),
    L('GAMBA ROJA DE HUELVA CAL. 2', 1, 'kg', 62, 'Aristeus antennatus', '37.1.1', 'Arrastre'),
    L('MEJILLÓN GALLEGO MALLA 2KG', 3, 'malla', 4.8, 'Mytilus galloprovincialis', 'Acuicultura · Galicia', 'Batea'),
    L('CALAMAR DE POTERA', 2.415, 'kg', 19.8, 'Loligo vulgaris', '27.VIII.c', 'Potera'),
    L('BACALAO DESALADO LOMO', 3.5, 'kg', 15.6, 'Gadus morhua', '27.II.a', 'Palangre'),
    L('ALMEJA FINA GALLEGA', 1.5, 'kg', 34, 'Ruditapes decussatus', '27.IX.a', 'Marisqueo a pie'),
    L('SALMÓN NORUEGO FILETE C/P', 5.125, 'kg', 12.4, 'Salmo salar', 'Acuicultura · Noruega', 'Jaula'),
  ];
  const totals = computeTotals(lines);
  const rows = lines
    .map(
      (l) =>
        `<tr class="m"><td>${esc(l.desc)}</td><td class="r">${fmt(l.qty, 3)}</td><td class="c">${l.unit === 'kg' ? 'KG' : 'MALLA'}</td><td class="r">${fmt(l.price, 2)}</td><td class="r">${fmt(l.total)}</td></tr>
         <tr class="s"><td colspan="5"><i>${l.sci}</i> · ${/^\d/.test(l.fao) ? `Zona FAO ${l.fao}` : l.fao} · ${l.arte}</td></tr>`,
    )
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'Liberation Serif', 'Times New Roman', serif; font-size: 11px; }
     .head { display: flex; justify-content: space-between; border-bottom: 3px double #134f5c; padding-bottom: 8px; }
     .n { font-size: 20px; color: #134f5c; font-weight: 700; font-variant: small-caps; }
     .f { text-align: right; }
     .f .t { font-size: 22px; letter-spacing: 3px; color: #134f5c; }
     .to { margin: 12px 0; width: 55%; }
     table.lines { width: 100%; margin-top: 6px; }
     table.lines th { background: #d0e0e3; padding: 4px 6px; text-align: left; border-bottom: 1px solid #134f5c; }
     tr.m td { padding: 4px 6px 0; font-weight: 700; }
     tr.s td { padding: 0 6px 5px 18px; font-size: 9px; color: #444; border-bottom: 1px solid #d0e0e3; }
     .tt { margin: 16px 0 0 auto; width: 45%; font-size: 12px; }
     .tt td { padding: 3px 6px; } .tt .g td { border-top: 2px solid #134f5c; font-size: 14px; font-weight: 700; }`,
    `<div class="head"><div><div class="n">${supplier.name}</div><div>Puerto pesquero de Santoña · Muelle de Poniente, s/n</div><div>39740 Santoña (Cantabria) · CIF: ${supplier.cif}</div><div>Tel. 942 660 118 · Autorización sanitaria 12.04567/S</div></div>
       <div class="f"><div class="t">FACTURA</div><div>Nº ${number}</div><div>Fecha: ${dateEs(date, '-')}</div></div></div>
     <div class="to"><b>Cliente:</b> Marisquería Punta Galea S.L. · NIF ${cif('B', '4870213')}<br>Paseo Marítimo, 7 · 48990 Getxo (Bizkaia)</div>
     <table class="lines"><thead><tr><th>Descripción</th><th class="r">Cantidad</th><th class="c">Ud.</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead><tbody>${rows}</tbody></table>
     <table class="tt"><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)} €</td></tr><tr><td>IVA 10%</td><td class="r">${fmt(totals.vatTotal)} €</td></tr><tr class="g"><td>Total</td><td class="r">${fmt(totals.total)} €</td></tr></table>
     <p style="font-size:9px;margin-top:22px">Mantener entre 0 y 4 ºC. Pago al contado. Información de trazabilidad conforme al Reglamento (UE) 1379/2013.</p>`,
  );
  return {
    id: 'inv03-pescados-fao',
    features: ['Descripción | Cantidad | Ud. | Precio | Importe (sin código)', 'sublínea de especie + zona FAO + arte', 'pesos de 3 decimales', 'números dentro de la descripción (600/800, CAL. 2)', 'fecha con guiones'],
    page: { format: 'A4', margin: '14mm' },
    html,
    expected: invoiceExpected({ id: 'inv03', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 04 · Bebidas: cajas + botellas, envases retornables y devolución ─────────────────────────────

function inv04() {
  const supplier = { name: 'Bebidas y Distribuciones Montes S.L.', cif: cif('B', '2489031') };
  const number = 'BD-2609-00318';
  const date = '2026-09-16';
  const L = (code, desc, cajas, qty, price, vat, unit = 'bot', extra = false) => ({ code, desc, cajas, qty, price, vat, unit, extra });
  const lines = [
    L('40110', 'CERVEZA ESTRELLA 1/3 RET. C/24', 5, 120, 0.66, 21),
    L('40115', 'CERVEZA SIN ALCOHOL 1/3 C/24', 2, 48, 0.59, 21),
    L('40201', 'BARRIL CERVEZA 30L', null, 2, 72.5, 21, 'ud'),
    L('41010', 'AGUA MINERAL 50CL C/35', 3, 105, 0.215, 10),
    L('41020', 'REFRESCO COLA 35CL C/24', 2, 48, 0.52, 21),
    L('41030', 'TÓNICA PREMIUM 20CL C/24', 1, 24, 0.61, 21),
    L('42001', 'VINO TINTO RIOJA CRIANZA 75CL', 2, 12, 5.45, 21),
    L('42010', 'VINO BLANCO RUEDA VERDEJO 75CL', 1, 6, 4.38, 21),
    L('42050', 'CAVA BRUT NATURE 75CL', 1, 6, 6.9, 21),
    L('43001', 'GINEBRA LONDON DRY 70CL', null, 3, 11.95, 21),
    L('49001', 'ENVASE RETORNABLE CAJA 1/3', 5, 5, 3.6, 21, 'caja', true),
    L('49002', 'DEVOLUCIÓN ENVASE CAJA 1/3', -4, -4, 3.6, 21, 'caja', true),
    L('49010', 'FIANZA BARRIL 30L', null, 2, 25, 21, 'ud', true),
  ];
  const totals = computeTotals(lines);
  const rows = lines
    .map((l) => {
      const env = l.unit === 'caja';
      return `<tr${l.extra ? ' class="x"' : ''}><td>${l.code}</td><td>${esc(l.desc)}</td><td class="r">${l.cajas === null ? '' : fmt(l.cajas, 0)}</td><td class="r">${env ? '' : fmt(l.qty, 0)}</td><td class="r">${fmt(l.price, 3)}</td><td class="r">${fmt(l.total)}</td><td class="c">${l.vat}</td></tr>`;
    })
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'FreeSans', Helvetica, sans-serif; font-size: 10px; }
     .band { background: #8e1b3a; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
     .band .n { font-size: 17px; font-weight: 700; } .band .t { font-size: 24px; font-weight: 300; letter-spacing: 4px; }
     .info { display: flex; justify-content: space-between; margin: 10px 0; }
     .info div { line-height: 1.45; }
     table.lines { width: 100%; }
     table.lines th { border-bottom: 1.5px solid #8e1b3a; padding: 4px 5px; text-align: left; color: #8e1b3a; }
     table.lines td { padding: 3px 5px; } table.lines tr:nth-child(even) td { background: #f7eef1; }
     tr.x td { font-style: italic; color: #444; }
     .foot { display: flex; justify-content: space-between; margin-top: 14px; }
     .iva th { border-bottom: 1px solid #999; padding: 3px 8px; } .iva td { padding: 3px 8px; }
     .gr td { padding: 3px 8px; } .gr .g td { background: #8e1b3a; color: #fff; font-weight: 700; font-size: 13px; }`,
    `<div class="band"><div><div class="n">${supplier.name}</div><div>Distribuidor oficial de bebidas para hostelería</div></div><div class="t">FACTURA</div></div>
     <div class="info"><div>Avda. de la Industria, 31 · 37008 Salamanca<br>CIF ${supplier.cif} · Tel. 923 190 455<br>pedidos@bebidasmontes.es</div>
       <div><b>Factura:</b> ${number}<br><b>Fecha:</b> ${dateEs(date)}<br><b>Cliente:</b> 2231 · Bar Restaurante La Plaza Mayor<br><b>NIF:</b> ${nif('07961124')}</div></div>
     <table class="lines"><thead><tr><th>Código</th><th>Artículo</th><th class="r">Cajas</th><th class="r">Botellas</th><th class="r">Precio</th><th class="r">Importe</th><th class="c">% IVA</th></tr></thead><tbody>${rows}</tbody></table>
     <div class="foot"><table class="iva"><tr><th>% IVA</th><th class="r">Base</th><th class="r">Cuota</th></tr>${totals.breakdown.map((b) => `<tr><td>${b.rate},00</td><td class="r">${fmt(b.base)}</td><td class="r">${fmt(b.vat)}</td></tr>`).join('')}</table>
       <table class="gr"><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)}</td></tr><tr><td>Cuota IVA</td><td class="r">${fmt(totals.vatTotal)}</td></tr><tr class="g"><td>TOTAL FACTURA</td><td class="r">${fmt(totals.total)} €</td></tr></table></div>
     <p style="margin-top:18px;font-size:8.5px">Los envases retornables se facturan en depósito y se abonan a su devolución en buen estado.</p>`,
  );
  return {
    id: 'inv04-bebidas-cajas-envases',
    features: ['Cajas | Botellas | Precio (3 decimales) | Importe', 'envases retornables, devolución (negativa) y fianza', 'IVA 10/21 por línea', 'cliente con NIF de persona física'],
    page: { format: 'A4', margin: '12mm' },
    html,
    expected: invoiceExpected({ id: 'inv04', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 05 · Ticket térmico de cash & carry (80 mm, monoespaciado) ─────────────────────────────

function inv05() {
  const supplier = { name: 'CASH & CARRY GASTRO SUR S.A.', cif: cif('A', '4123456') };
  const number = 'T012-2026-058831';
  const date = '2026-09-23';
  const code = { 4: 'A', 10: 'B', 21: 'C' };
  // mode: 'single' (código + descripción + importe), 'mult' (línea "x6  0,82  4,92"), 'weight' (kg × €/kg)
  const L = (c, desc, mode, qty, price, vat, unit = 'ud') => ({ code: c, desc, mode, qty, price, vat, unit });
  const lines = [
    L('2104578', 'LECHE ENTERA BRIK 1L', 'mult', 6, 0.82, 4),
    L('3301456', 'HUEVOS CAMPEROS M 30U', 'single', 1, 7.45, 4),
    L('5500123', 'CEBOLLA MALLA 5KG', 'single', 1, 3.95, 4),
    L('2201887', 'QUESO CURADO CUÑA', 'weight', 0.845, 14.9, 4, 'kg'),
    L('6610022', 'ACEITE GIRASOL 5L', 'mult', 2, 9.65, 4),
    L('7012345', 'TOMATE TRITURADO 3KG', 'mult', 3, 3.1, 10),
    L('7015501', 'ATUN CLARO RO-900', 'single', 1, 8.75, 10),
    L('8800120', 'PAPEL COCINA 2 ROLLOS', 'mult', 4, 2.95, 21),
    L('8811403', 'BOLSA BASURA 85X105', 'single', 1, 4.2, 21),
    L('2200045', 'JAMON COCIDO EXTRA', 'weight', 1.26, 9.8, 10, 'kg'),
    L('4401987', 'NATA COCINA 1L', 'mult', 6, 2.15, 10),
    L('1109876', 'PAN BARRA PRECOCIDA', 'mult', 20, 0.29, 4),
  ];
  const totals = computeTotals(lines);
  const W = 42;
  const pad = (a, b) => `${a}${' '.repeat(Math.max(1, W - a.length - b.length))}${b}`;
  const center = (s) => `${' '.repeat(Math.max(0, Math.floor((W - s.length) / 2)))}${s}`;
  const out = [];
  out.push(center(supplier.name), center(`CIF ${supplier.cif.slice(0, 1)}-${supplier.cif.slice(1)}`), center('Pol. Ind. La Isla, C/ Rio Viejo 12'), center('41703 Dos Hermanas (Sevilla)'), center('Tel. 954 000 111'));
  out.push('-'.repeat(W), `FACTURA SIMPLIFICADA: ${number}`, `FECHA ${dateEs(date)}  HORA 08:14  CAJA 12`, `CLIENTE 004512 BAR LA ESQUINA S.L.`, `NIF CLIENTE ${cif('B', '4198765')}`, '-'.repeat(W));
  out.push('PRECIOS SIN IVA', pad('ART.    DESCRIPCION', 'IMPORTE  '), '-'.repeat(W));
  for (const l of lines) {
    const amount = `${fmt(l.total)} ${code[l.vat]}`;
    if (l.mode === 'single') out.push(pad(`${l.code} ${l.desc}`, amount));
    else if (l.mode === 'mult') out.push(`${l.code} ${l.desc}`, pad(`        x${l.qty}    ${fmt(l.price)}`, amount));
    else out.push(`${l.code} ${l.desc}`, pad(`     ${fmt(l.qty, 3)} kg x ${fmt(l.price)} EUR/kg`, amount));
  }
  out.push('-'.repeat(W), `TOTAL ARTICULOS: ${lines.length}`, '');
  out.push(pad('IVA     BASE      CUOTA', ''));
  for (const b of totals.breakdown) out.push(pad(`${code[b.rate]} ${String(b.rate).padStart(2)}%  ${fmt(b.base).padStart(7)}  ${fmt(b.vat).padStart(7)}`, ''));
  out.push('', pad('BASE IMPONIBLE', fmt(totals.subtotal)), pad('TOTAL IVA', fmt(totals.vatTotal)), pad('TOTAL', `${fmt(totals.total)} EUR`), pad('ENTREGADO TARJETA', fmt(totals.total)), '', center('GRACIAS POR SU VISITA'), center('Conserve este ticket'));
  const html = doc(
    `Ticket ${number}`,
    `body { font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace; font-size: 10.6px; width: 80mm; }
     pre { margin: 0; padding: 4mm 3mm; font: inherit; line-height: 1.32; white-space: pre; }`,
    `<pre>${esc(out.join('\n'))}</pre>`,
  );
  return {
    id: 'inv05-ticket-cash-carry',
    features: ['ticket térmico 80 mm monoespaciado', 'descripción y números en filas distintas (x6 0,82 4,92)', 'artículos a peso (kg × EUR/kg)', 'códigos de IVA A/B/C', 'totales al pie', 'CIF con guion'],
    page: { width: '80mm', autoHeight: true },
    html,
    expected: invoiceExpected({ id: 'inv05', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 06 · Albarán valorado de obrador (cantidad antes de la descripción) ─────────────────────────────

function inv06() {
  const supplier = { name: 'Obrador Panadería Santa Clara S.L.', cif: cif('B', '1435527') };
  const number = 'AV-26-03412';
  const date = '2026-09-24';
  const L = (qty, desc, price, vat) => ({ qty, desc, price, vat, unit: 'ud' });
  const lines = [
    L(40, 'BARRA DE PAN RÚSTICA 250G', 0.42, 4),
    L(25, 'PAN DE HAMBURGUESA BRIOCHE', 0.55, 4),
    L(3, 'HOGAZA DE CENTENO 1KG', 3.2, 4),
    L(60, 'PANECILLO INDIVIDUAL 40G', 0.18, 4),
    L(12, 'CROISSANT DE MANTEQUILLA', 0.85, 10),
    L(2, 'TARTA DE QUESO 12 RACIONES', 24, 10),
    L(1, 'BIZCOCHO DE LIMÓN 1KG', 9.5, 10),
    L(30, 'PICOS DE PAN 250G', 1.15, 4),
  ];
  const totals = computeTotals(lines);
  const rows = lines.map((l) => `<tr><td class="c">${l.qty}</td><td>${esc(l.desc)}</td><td class="r">${fmt(l.price)}</td><td class="r">${fmt(l.total)}</td></tr>`).join('');
  const html = doc(
    `Albarán ${number}`,
    `body { font-family: 'Liberation Sans', Arial, sans-serif; font-size: 11px; }
     .h { display: flex; justify-content: space-between; align-items: flex-end; }
     .n { font-family: 'Liberation Serif', serif; font-size: 22px; font-style: italic; color: #6b3e1f; }
     .doc { border: 2px solid #6b3e1f; padding: 6px 12px; text-align: center; }
     .doc .t { font-weight: 700; font-size: 14px; letter-spacing: 1px; }
     .grid { display: grid; grid-template-columns: repeat(4, 1fr); margin: 12px 0; border: 1px solid #999; }
     .grid div { padding: 4px 6px; border-right: 1px solid #999; } .grid div:last-child { border-right: 0; }
     .grid .k { font-size: 8px; color: #666; text-transform: uppercase; display: block; }
     table.lines { width: 100%; border: 1px solid #999; }
     table.lines th { background: #f1e7dc; padding: 5px; border-bottom: 1px solid #999; text-align: left; }
     table.lines td { padding: 5px; border-bottom: 1px solid #eee; }
     .t2 { margin: 12px 0 0 auto; width: 48%; } .t2 td { padding: 3px 6px; } .t2 .g td { border-top: 2px solid #6b3e1f; font-weight: 700; font-size: 13px; }
     .firma { margin-top: 26px; display: flex; gap: 20px; } .firma div { flex: 1; border: 1px dashed #999; height: 60px; padding: 4px; font-size: 9px; color: #666; }`,
    `<div class="h"><div><div class="n">${supplier.name}</div><div>C/ Horno de Santa Clara, 3 · 47002 Valladolid · CIF ${supplier.cif}</div><div>Tel. 983 301 227 · Pan artesano desde 1956</div></div>
       <div class="doc"><div class="t">ALBARÁN VALORADO</div><div>Nº ${number}</div></div></div>
     <div class="grid"><div><span class="k">Fecha</span>${dateEs(date, '.')}</div><div><span class="k">Cliente</span>Hotel Restaurante Doña Urraca</div><div><span class="k">Pedido nº</span>5567</div><div><span class="k">Ruta / repartidor</span>3 · Javier M.</div></div>
     <table class="lines"><thead><tr><th class="c" style="width:70px">Cantidad</th><th>Descripción</th><th class="r" style="width:80px">Precio</th><th class="r" style="width:90px">Importe</th></tr></thead><tbody>${rows}</tbody></table>
     <table class="t2"><tr><td>Suma neto</td><td class="r">${fmt(totals.subtotal)}</td></tr>${totals.breakdown.map((b) => `<tr><td>IVA ${b.rate}% s/ ${fmt(b.base)}</td><td class="r">${fmt(b.vat)}</td></tr>`).join('')}<tr class="g"><td>TOTAL ALBARÁN</td><td class="r">${fmt(totals.total)} €</td></tr></table>
     <div class="firma"><div>Recibí conforme (firma y sello del cliente)</div><div>Observaciones: entregar antes de las 7:30 por la puerta de servicio</div></div>`,
  );
  return {
    id: 'inv06-albaran-valorado',
    features: ['albarán valorado (sin «factura»)', 'Cantidad | Descripción | Precio | Importe', 'fecha con puntos', 'IVA «s/ base» por tipo', 'número en caja «ALBARÁN VALORADO Nº»'],
    page: { format: 'A4', margin: '14mm' },
    html,
    expected: invoiceExpected({ id: 'inv06', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 07 · Apaisada: Lote, Cad., Bultos, Dto.1 + Dto.2, pronto pago ─────────────────────────────

function inv07() {
  const supplier = { name: 'Distribuciones Horeca Meseta S.L.', cif: cif('B', '4507789') };
  const customer = { name: 'Grupo Tierra y Brasa S.L.', cif: cif('B', '4721190') };
  const number = 'DHM26-00917';
  const date = '2026-09-18';
  const L = (code, desc, lot, cad, bultos, qty, unit, price, vat, dto, dto2) => ({ code, desc, lot, cad, bultos, qty, unit, price, vat, dto, dto2 });
  const lines = [
    L('CG1020', 'PATATA PREFRITA 9MM CONGELADA', 'L2609A', '03/2028', 4, 40, 'kg', 1.38, 10),
    L('CG1105', 'CROQUETA JAMÓN IBÉRICO 1KG', '260914', '12/2027', 2, 12, 'ud', 6.75, 10, 5),
    L('CG2010', 'GUISANTE FINO CONGELADO 2,5KG', 'G5512', '06/2028', 1, 4, 'ud', 5.9, 4),
    L('RF3001', 'NATA PARA COCINAR 35% 1L', 'N0925', '30/10/2026', 1, 12, 'ud', 3.45, 10, 5, 2),
    L('RF3010', 'MANTEQUILLA SIN SAL 1KG', 'M4471', '15/11/2026', 1, 5, 'ud', 8.9, 10),
    L('RF3022', 'QUESO MOZZARELLA RALLADO 2KG', '260901', '20/10/2026', 1, 4, 'ud', 11.2, 4, 3),
    L('RF3030', 'YOGUR NATURAL 125G PACK 24', 'Y0911', '10/10/2026', 1, 2, 'ud', 7.8, 10),
    L('CG4001', 'GAMBA PELADA CRUDA 1KG', 'P77120', '09/2027', 2, 6, 'kg', 13.95, 10),
    L('CG4015', 'CALAMAR ANILLAS A LA ROMANA 1KG', 'P77342', '11/2027', 1, 5, 'kg', 7.4, 10, 4),
    L('CG5001', 'HELADO DE VAINILLA CUBETA 5L', 'H2231', '05/2028', 1, 2, 'ud', 14.6, 10),
  ];
  const totals = computeTotals(lines, { globalDiscountPct: 2 });
  const rows = lines
    .map(
      (l) =>
        `<tr><td>${l.code}</td><td>${esc(l.desc)}</td><td>${l.lot}</td><td>${l.cad}</td><td class="r">${l.bultos}</td><td class="r">${fmt(l.qty, l.unit === 'kg' ? 3 : 0)}</td><td class="c">${l.unit.toUpperCase()}</td><td class="r">${fmt(l.price, 3)}</td><td class="r">${l.dto ? fmt(l.dto, 2) : ''}</td><td class="r">${l.dto2 ? fmt(l.dto2, 2) : ''}</td><td class="r">${fmt(l.total)}</td><td class="c">${l.vat}</td></tr>`,
    )
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'Liberation Sans', Arial, sans-serif; font-size: 9.5px; }
     .top { display: grid; grid-template-columns: 1.1fr 1fr; gap: 20px; }
     .s .n { font-size: 16px; font-weight: 700; color: #274e13; }
     .c2 { border: 1px solid #274e13; padding: 6px 10px; }
     .c2 .k { color: #274e13; font-weight: 700; font-size: 8px; letter-spacing: 1px; }
     table.grid { width: 100%; margin: 10px 0; border: 1px solid #274e13; }
     table.grid th { background: #274e13; color: #fff; font-size: 8.5px; padding: 3px 6px; text-align: left; }
     table.grid td { padding: 4px 6px; font-size: 10.5px; }
     table.lines { width: 100%; }
     table.lines th { background: #d9ead3; padding: 4px; text-align: left; border-top: 1px solid #274e13; border-bottom: 1px solid #274e13; }
     table.lines td { padding: 3px 4px; border-bottom: 1px solid #eee; }
     .bottom { display: flex; justify-content: space-between; margin-top: 12px; }
     .bottom td { padding: 2px 8px; } .bottom th { padding: 2px 8px; border-bottom: 1px solid #274e13; text-align: left; }
     .g td { font-weight: 700; font-size: 12px; border-top: 2px solid #274e13; }`,
    `<div class="top"><div class="s"><div class="n">${supplier.name}</div><div>Pol. Ind. Los Olmos, parcela 22 · 47012 Valladolid</div><div>CIF: ${supplier.cif} · Tel. 983 450 900 · Fax 983 450 901</div></div>
       <div class="c2"><div class="k">CLIENTE / DIRECCIÓN DE ENTREGA</div><div class="b">${customer.name}</div><div>C/ Santiago, 14 · 47001 Valladolid · CIF: ${customer.cif}</div></div></div>
     <table class="grid"><tr><th>Nº FACTURA</th><th>FECHA</th><th>CÓD. CLIENTE</th><th>FORMA DE PAGO</th><th>VENCIMIENTO</th><th>PÁGINA</th></tr>
       <tr><td class="b">${number}</td><td>${dateEs(date)}</td><td>11807</td><td>Transferencia 30 días</td><td>18/10/2026</td><td>1/1</td></tr></table>
     <table class="lines"><thead><tr><th>Ref.</th><th>Descripción</th><th>Lote</th><th>Cad.</th><th class="r">Bultos</th><th class="r">Cantidad</th><th class="c">Ud.</th><th class="r">Precio</th><th class="r">Dto.1</th><th class="r">Dto.2</th><th class="r">Importe</th><th class="c">IVA</th></tr></thead><tbody>${rows}</tbody></table>
     <div class="bottom"><table><tr><th>% IVA</th><th class="r">Base imponible</th><th class="r">Cuota</th></tr>${totals.breakdown.map((b) => `<tr><td>${b.rate} %</td><td class="r">${fmt(b.base)}</td><td class="r">${fmt(b.vat)}</td></tr>`).join('')}</table>
       <table><tr><td>Importe bruto</td><td class="r">${fmt(totals.gross)}</td></tr><tr><td>Dto. pronto pago 2%</td><td class="r">-${fmt(totals.discount)}</td></tr><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)}</td></tr><tr><td>Total IVA</td><td class="r">${fmt(totals.vatTotal)}</td></tr><tr class="g"><td>TOTAL FACTURA</td><td class="r">${fmt(totals.total)} €</td></tr></table></div>`,
  );
  return {
    id: 'inv07-apaisada-lotes-dto-doble',
    features: ['página apaisada', '12 columnas: Ref | Descripción | Lote | Cad. | Bultos | Cantidad | Ud. | Precio | Dto.1 | Dto.2 | Importe | IVA', 'lotes numéricos', 'dos descuentos en cascada', 'descuento por pronto pago', 'cabecera en rejilla (etiqueta arriba, valor debajo) con fecha de vencimiento'],
    page: { format: 'A4', landscape: true, margin: '10mm' },
    html,
    expected: invoiceExpected({ id: 'inv07', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 08 · Letra de 8 px, precios de 4 decimales, miles, sin columna de unidad ─────────────────────────────

function inv08() {
  const supplier = { name: 'Comercial Gastronómica del Norte S.A.', cif: cif('A', '4803316') };
  const number = '26/F/002231';
  const date = '2026-09-21';
  const L = (desc, qty, price, vat, unit = 'ud') => ({ desc, qty, price, vat, unit });
  const lines = [
    L('PATATA AGRIA LAVADA', 150, 0.895, 4, 'kg'),
    L('CEBOLLA AMARILLA', 60, 0.74, 4, 'kg'),
    L('ZANAHORIA', 25, 0.92, 4, 'kg'),
    L('PIMIENTO VERDE ITALIANO', 12.5, 2.15, 4, 'kg'),
    L('TOMATE RAMA', 18.4, 1.99, 4, 'kg'),
    L('LECHUGA ICEBERG', 24, 0.68, 4),
    L('AJO SECO MALLA 1KG', 5, 4.75, 4),
    L('LIMÓN VERNA', 10, 1.35, 4, 'kg'),
    L('NARANJA DE ZUMO', 40, 0.82, 4, 'kg'),
    L('MANZANA GOLDEN', 15, 1.65, 4, 'kg'),
    L('PLÁTANO DE CANARIAS', 12, 1.98, 4, 'kg'),
    L('FRESÓN DE HUELVA', 6, 3.4, 4, 'kg'),
    L('CHAMPIÑÓN LAMINADO 1KG', 8, 3.15, 4),
    L('CALABACÍN', 9.6, 1.45, 4, 'kg'),
    L('BERENJENA', 7.2, 1.6, 4, 'kg'),
    L('PUERRO', 6, 1.75, 4, 'kg'),
    L('PEREJIL MANOJO', 20, 0.45, 4),
    L('ACEITE OLIVA VIRGEN EXTRA GARRAFA 5L', 32, 38.58, 4),
    L('VINAGRE DE VINO BLANCO 5L', 4, 3.9, 10),
    L('SAL FINA 1KG', 12, 0.49, 10),
    L('SERVILLETA CÓCTEL 20X20', 1200, 0.0215, 21),
    L('GUANTES NITRILO T/M CAJA 100', 10, 5.45, 21),
    L('BOLSA BASURA 85X105 ROLLO 10', 15, 1.89, 21),
    L('HUEVOS CAMPEROS L DOCENA', 30, 2.65, 4),
    L('LECHE SEMIDESNATADA 1L', 48, 0.79, 4),
    L('QUESO MANCHEGO SEMICURADO', 6.85, 12.4, 4, 'kg'),
  ];
  const totals = computeTotals(lines);
  const qtyTxt = (q) => (Number.isInteger(q) ? fmt(q, 0) : fmt(q, String(q).split('.')[1].length));
  const rows = lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="r">${qtyTxt(l.qty)}</td><td class="r">${fmt(l.price, 4)}</td><td class="r">${fmt(l.total)}</td><td class="c">${l.vat}</td></tr>`).join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'Liberation Sans', Arial, sans-serif; font-size: 8px; }
     .h { display: flex; justify-content: space-between; margin-bottom: 8px; }
     .n { font-size: 12px; font-weight: 700; }
     table.lines { width: 100%; }
     table.lines th { border-bottom: 1px solid #000; padding: 2px 3px; text-align: left; }
     table.lines td { padding: 1px 3px; }
     .t { display: flex; justify-content: flex-end; gap: 30px; margin-top: 8px; }
     .t td { padding: 1px 6px; } .t th { padding: 1px 6px; border-bottom: 1px solid #000; }`,
    `<div class="h"><div><div class="n">${supplier.name}</div><div>Mercabilbao, pabellón B, puestos 12-14 · 48970 Basauri (Bizkaia) · CIF ${supplier.cif}</div></div>
       <div class="r"><div class="n">FACTURA ${number}</div><div>Fecha factura: ${dateEs(date)}</div><div>Cliente: Sociedad Gastronómica Txoko Zaharra · NIF ${cif('G', '4801937')}</div></div></div>
     <table class="lines"><thead><tr><th>Descripción</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Importe</th><th class="c">% IVA</th></tr></thead><tbody>${rows}</tbody></table>
     <div class="t"><table><tr><th>% IVA</th><th class="r">Base</th><th class="r">Cuota</th></tr>${totals.breakdown.map((b) => `<tr><td>${b.rate}</td><td class="r">${fmt(b.base)}</td><td class="r">${fmt(b.vat)}</td></tr>`).join('')}</table>
       <table><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)}</td></tr><tr><td>Cuota IVA</td><td class="r">${fmt(totals.vatTotal)}</td></tr><tr><td class="b">Total factura</td><td class="r b">${fmt(totals.total)} €</td></tr></table></div>`,
  );
  return {
    id: 'inv08-letra-8px-4-decimales',
    features: ['letra de 8 px', 'Descripción | Cantidad | Precio | Importe (cantidad tras la descripción, sin unidad)', 'precios de 4 decimales (0,8950)', 'miles en cantidades (1.200) e importes (1.234,56)', 'cliente con CIF de letra G'],
    page: { format: 'A4', margin: '12mm' },
    html,
    expected: invoiceExpected({ id: 'inv08', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 09 · Descripciones en 2–3 filas (números centrados verticalmente) ─────────────────────────────

function inv09() {
  const supplier = { name: 'Ibéricos y Embutidos de Guijuelo S.L.', cif: cif('B', '3714428') };
  const number = 'IEG-2026-1409';
  const date = '2026-09-15';
  const L = (code, desc, qty, unit, price) => ({ code, desc, qty, unit, price, vat: 10 });
  const lines = [
    L('J100', 'JAMÓN IBÉRICO DE BELLOTA 100% RAZA IBÉRICA LONCHEADO A CUCHILLO 100 G', 10, 'ud', 12.8),
    L('P210', 'PALETA IBÉRICA DE CEBO DE CAMPO DESHUESADA PIEZA 2,5 KG APROX.', 2.64, 'kg', 29.5),
    L('L305', 'LOMO EMBUCHADO IBÉRICO DE BELLOTA MEDIA PIEZA ENVASADO AL VACÍO', 1.21, 'kg', 38.9),
    L('C410', 'CHORIZO IBÉRICO CULAR EXTRA CURACIÓN NATURAL', 2.48, 'kg', 16.4),
    L('S420', 'SALCHICHÓN IBÉRICO DE BELLOTA VELA', 1.95, 'kg', 18.2),
    L('Q501', 'QUESO DE OVEJA CURADO EN ACEITE DE OLIVA D.O.P. MANCHEGO', 3.1, 'kg', 17.8),
    L('M430', 'MORCÓN IBÉRICO', 1.5, 'kg', 15.6),
    L('S440', 'SOBRASADA DE MALLORCA I.G.P. CULANA TRADICIONAL', 2, 'ud', 9.75),
  ];
  const totals = computeTotals(lines);
  const rows = lines
    .map((l) => `<tr><td>${l.code}</td><td class="d">${esc(l.desc)}</td><td class="r">${fmt(l.qty, l.unit === 'kg' ? 3 : 0)}</td><td class="c">${l.unit === 'kg' ? 'Kg' : 'Ud'}</td><td class="r">${fmt(l.price)}</td><td class="r">${fmt(l.total)}</td></tr>`)
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'DejaVu Serif', Georgia, serif; font-size: 10px; }
     .h { text-align: center; border-bottom: 1px solid #783f04; padding-bottom: 6px; }
     .h .n { font-size: 18px; color: #783f04; letter-spacing: 1px; }
     .m { display: flex; justify-content: space-between; margin: 10px 0; }
     table.lines { width: 100%; }
     table.lines th { background: #783f04; color: #fff; padding: 4px 6px; text-align: left; }
     table.lines td { padding: 4px 6px; border-bottom: 1px solid #e6d5c3; vertical-align: middle; }
     td.d { width: 190px; }
     .t { margin: 12px 0 0 auto; width: 40%; } .t td { padding: 2px 6px; } .t .g td { font-weight: 700; border-top: 1px solid #783f04; }`,
    `<div class="h"><div class="n">${supplier.name}</div><div>Ctra. de Salamanca, 42 · 37770 Guijuelo (Salamanca) · C.I.F. ${supplier.cif} · Tel. 923 580 144</div></div>
     <div class="m"><div><b>Factura nº:</b> ${number}<br><b>Fecha:</b> ${dateEs(date)}</div><div><b>Cliente:</b> Taberna Los Arcos<br>Plaza Mayor, 3 · 37002 Salamanca · NIF ${cif('B', '3799130')}</div></div>
     <table class="lines"><thead><tr><th>Código</th><th>Descripción</th><th class="r">Cantidad</th><th class="c">Ud.</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead><tbody>${rows}</tbody></table>
     <table class="t"><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)}</td></tr><tr><td>IVA 10 %</td><td class="r">${fmt(totals.vatTotal)}</td></tr><tr class="g"><td>Total factura</td><td class="r">${fmt(totals.total)} €</td></tr></table>`,
  );
  return {
    id: 'inv09-descripciones-dos-filas',
    features: ['descripciones partidas en 2–3 filas', 'números centrados verticalmente entre las filas de la descripción', 'C.I.F. con puntos'],
    page: { format: 'A4', margin: '14mm' },
    html,
    expected: invoiceExpected({ id: 'inv09', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 10 · Frutería: cantidad primero, códigos de IVA, abono negativo, 3 decimales ─────────────────────────────

function inv10() {
  const supplier = { name: 'Hortofrutícola Vega del Tajo S. Coop.', cif: cif('F', '4502213') };
  const number = 'VT-004512';
  const date = '2026-09-20';
  const code = { 4: 'A', 10: 'B', 21: 'C' };
  const L = (qty, unit, desc, price, vat) => ({ qty, unit, desc, price, vat });
  const lines = [
    L(12.5, 'kg', 'TOMATE PERA', 1.85, 4),
    L(8, 'kg', 'PIMIENTO ROJO CALIFORNIA', 2.45, 4),
    L(25, 'kg', 'PATATA NUEVA', 0.895, 4),
    L(6, 'ud', 'LECHUGA ROMANA', 0.78, 4),
    L(10, 'manojo', 'CILANTRO MANOJO', 0.65, 4),
    L(4.25, 'kg', 'AGUACATE HASS', 4.9, 4),
    L(3, 'caja', 'FRESA CAJA 2KG', 7.5, 4),
    L(2, 'bandeja', 'SETAS SHIITAKE BANDEJA 250G', 2.95, 4),
    L(6, 'ud', 'ZUMO DE NARANJA NATURAL 1L', 2.35, 10),
    L(1, 'paquete', 'BOLSA PAPEL KRAFT 100 UDS', 6.2, 21),
    L(-3.5, 'kg', 'ABONO TOMATE PERA DEFECTUOSO', 1.85, 4),
  ];
  const totals = computeTotals(lines);
  const U = { kg: 'KG', ud: 'UD', manojo: 'MNJ', caja: 'CJ', bandeja: 'BDJ', paquete: 'PAQ' };
  const rows = lines
    .map((l) => `<tr${l.qty < 0 ? ' class="neg"' : ''}><td class="r">${fmt(l.qty, 3)}</td><td class="c">${U[l.unit]}</td><td>${esc(l.desc)}</td><td class="r">${fmt(l.price, 3)}</td><td class="c">${code[l.vat]}</td><td class="r">${fmt(l.total)}</td></tr>`)
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'FreeSans', Arial, sans-serif; font-size: 10.5px; }
     .h { display: flex; gap: 14px; align-items: center; }
     .logo { width: 54px; height: 54px; border-radius: 50%; background: #38761d; color: #fff; font-size: 22px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
     .n { font-size: 16px; font-weight: 700; color: #38761d; }
     .box { display: flex; justify-content: space-between; margin: 12px 0; padding: 8px; background: #f3f8ef; }
     table.lines { width: 100%; }
     table.lines th { border-bottom: 2px solid #38761d; padding: 4px; text-align: left; }
     table.lines td { padding: 3px 4px; border-bottom: 1px solid #e5eee0; }
     tr.neg td { color: #b00; }
     .f { display: flex; justify-content: space-between; margin-top: 14px; }
     .f td, .f th { padding: 2px 8px; } .f th { border-bottom: 1px solid #38761d; text-align: left; }
     .g td { font-size: 13px; font-weight: 700; border-top: 2px solid #38761d; }`,
    `<div class="h"><div class="logo">VT</div><div><div class="n">${supplier.name}</div><div>Camino de la Vega, 9 · 45600 Talavera de la Reina (Toledo) · CIF ${supplier.cif}</div><div>Tel. 925 800 612 · Registro de Cooperativas CLM TO-1128</div></div></div>
     <div class="box"><div><b>FACTURA Nº</b> ${number} &nbsp;&nbsp; <b>FECHA</b> ${dateEs(date)}</div><div><b>CLIENTE</b> Casa Emilio Restaurante · NIF ${nif('03865512')}</div></div>
     <table class="lines"><thead><tr><th class="r">Cant.</th><th class="c">Ud.</th><th>Descripción</th><th class="r">Precio</th><th class="c">C.IVA</th><th class="r">Importe</th></tr></thead><tbody>${rows}</tbody></table>
     <div class="f"><table><tr><th>Cód.</th><th class="r">Base</th><th class="r">% IVA</th><th class="r">Cuota</th></tr>${totals.breakdown.map((b) => `<tr><td>${code[b.rate]}</td><td class="r">${fmt(b.base)}</td><td class="r">${fmt(b.rate, 2)}</td><td class="r">${fmt(b.vat)}</td></tr>`).join('')}</table>
       <table><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)}</td></tr><tr><td>IVA</td><td class="r">${fmt(totals.vatTotal)}</td></tr><tr class="g"><td>TOTAL</td><td class="r">${fmt(totals.total)} €</td></tr></table></div>`,
  );
  return {
    id: 'inv10-fruteria-codigos-iva-abono',
    features: ['Cant. | Ud. | Descripción | Precio | C.IVA | Importe (cantidad primero)', 'código de IVA entre precio e importe', 'línea de abono con cantidad negativa', 'precios de 3 decimales', 'S. Coop. con CIF F'],
    page: { format: 'A4', margin: '14mm' },
    html,
    expected: invoiceExpected({ id: 'inv10', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 11 · Programa de facturación moderno: Precio antes que Unidades y Total con IVA por línea ─────────────────────────────

function inv11() {
  const supplier = { name: 'Café Tostadero Aurora S.L.', cif: cif('B', '6592204') };
  const customer = { name: 'Restaurante Mar de Fondo S.L.', cif: cif('B', '6701183') };
  const number = 'F2026-0317';
  const date = '2026-09-21';
  const L = (desc, price, qty, vat) => ({ desc, price, qty, vat, unit: 'ud' });
  const lines = [
    L('Café en grano mezcla 80/20 1 kg', 16.5, 10, 10),
    L('Café descafeinado molido 500 g', 9.8, 4, 10),
    L('Azucarillos 8 g (caja 1.000 uds)', 12.9, 2, 10),
    L('Leche de avena barista 1 L', 2.35, 12, 10),
    L('Revisión y limpieza de máquina espresso', 45, 1, 21),
    L('Vasos de cartón 8 oz (pack 50)', 3.6, 5, 21),
  ];
  const totals = computeTotals(lines);
  const rows = lines
    .map((l) => `<tr><td>${esc(l.desc)}</td><td class="r">${fmt(l.price)} €</td><td class="r">${l.qty}</td><td class="r">${fmt(l.total)} €</td><td class="r">${l.vat}%</td><td class="r">${fmt(r2(l.total * (1 + l.vat / 100)))} €</td></tr>`)
    .join('');
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'DejaVu Sans', sans-serif; font-size: 10px; color: #333; }
     .top { display: flex; justify-content: space-between; align-items: flex-start; }
     .brand { font-size: 20px; font-weight: 700; color: #b45f06; }
     .brand small { display: block; font-size: 9px; font-weight: 400; color: #777; }
     .inv { text-align: right; } .inv .t { font-size: 13px; color: #777; } .inv .no { font-size: 18px; font-weight: 700; }
     .parties { display: flex; gap: 30px; margin: 22px 0; }
     .parties div { flex: 1; } .parties .k { font-size: 8px; text-transform: uppercase; color: #999; letter-spacing: 1px; }
     table.lines { width: 100%; }
     table.lines th { color: #999; font-weight: 400; font-size: 8.5px; text-transform: uppercase; border-bottom: 1px solid #ddd; padding: 6px 4px; text-align: left; }
     table.lines td { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; }
     .sum { margin: 16px 0 0 auto; width: 42%; } .sum td { padding: 4px; } .sum .g td { font-size: 14px; font-weight: 700; border-top: 1px solid #333; }`,
    `<div class="top"><div class="brand">${supplier.name}<small>Tostadores de café de especialidad</small></div>
       <div class="inv"><div class="t">Factura</div><div class="no">${number}</div><div>Fecha de emisión: ${dateLong(date)}</div><div>Vencimiento: 21/10/2026</div></div></div>
     <div class="parties"><div><div class="k">Emisor</div><b>${supplier.name}</b><br>C/ del Tostadero, 5 · 36202 Vigo (Pontevedra)<br>NIF: ${supplier.cif}<br>hola@cafeaurora.es</div>
       <div><div class="k">Cliente</div><b>${customer.name}</b><br>Rúa do Porto, 21 · 36201 Vigo<br>NIF: ${customer.cif}</div></div>
     <table class="lines"><thead><tr><th>Concepto</th><th class="r">Precio</th><th class="r">Unidades</th><th class="r">Subtotal</th><th class="r">IVA</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
     <table class="sum"><tr><td>Base imponible</td><td class="r">${fmt(totals.subtotal)} €</td></tr>${totals.breakdown.map((b) => `<tr><td>IVA ${b.rate}%</td><td class="r">${fmt(b.vat)} €</td></tr>`).join('')}<tr class="g"><td>Total</td><td class="r">${fmt(totals.total)} €</td></tr></table>
     <p style="margin-top:30px;color:#777">Pago por transferencia a ES12 0081 5231 7600 0123 4567 antes del vencimiento.</p>`,
  );
  return {
    id: 'inv11-software-precio-antes-unidades',
    features: ['Concepto | Precio | Unidades | Subtotal | IVA | Total (con IVA)', 'precio antes que la cantidad', 'importe con IVA por línea al final', 'descripciones en minúsculas con números (80/20, 1.000 uds)', 'fecha larga «21 de septiembre de 2026» y fecha de vencimiento', 'importes con €'],
    page: { format: 'A4', margin: '16mm' },
    html,
    expected: invoiceExpected({ id: 'inv11', features: [], supplier, number, date, lines, totals }),
  };
}

// ───────────────────────────── 12 · Lácteos: códigos EAN-13 y pie horizontal de ERP (bruto, base, %IVA, cuota, %R.E.) ─────────────────────────────

function inv12() {
  const supplier = { name: 'Lácteos y Huevos Sierra Norte S.L.', cif: cif('B', '8761502') };
  const number = 'A-2026-07734';
  const date = '2026-09-22';
  const L = (code, desc, qty, price, vat, dto) => ({ code, desc, qty, price, vat, dto, unit: 'ud' });
  const lines = [
    L('8437004512018', 'LECHE ENTERA UHT 1L', 24, 0.78, 4),
    L('8437004512117', 'NATA PARA MONTAR 35% 1L', 12, 3.15, 10),
    L('8437004513015', 'HUEVOS FRESCOS L ESTUCHE 30', 5, 6.4, 4),
    L('8437004514012', 'QUESO DE BURGOS NATURAL 1KG', 4, 5.85, 4),
    L('8437004515019', 'YOGUR GRIEGO NATURAL 1KG', 6, 3.9, 10, 10),
    L('8437004516016', 'MANTEQUILLA CON SAL 500G', 8, 4.1, 10),
    L('8437004517013', 'QUESO CURADO DE OVEJA 3KG', 2, 42.6, 4, 5),
    L('8437004518010', 'REQUESÓN FRESCO 500G', 6, 2.75, 4),
    L('8437004519017', 'MOZZARELLA FIOR DI LATTE 125G', 20, 1.05, 4),
    L('8437004520013', 'BATIDO DE CACAO 200ML PACK 3', 10, 1.35, 10),
  ];
  const totals = computeTotals(lines);
  const rows = lines.map((l) => `<tr><td>${l.code}</td><td>${esc(l.desc)}</td><td class="r">${l.qty}</td><td class="r">${fmt(l.price)}</td><td class="r">${l.dto ? fmt(l.dto) : ''}</td><td class="r">${fmt(l.total)}</td></tr>`).join('');
  const b = totals.breakdown;
  const html = doc(
    `Factura ${number}`,
    `body { font-family: 'Liberation Mono', 'Courier New', monospace; font-size: 9.5px; }
     .frame { border: 1px solid #000; padding: 8px; }
     .h { display: flex; justify-content: space-between; }
     .n { font-size: 14px; font-weight: 700; }
     .k { border: 1px solid #000; padding: 4px 8px; margin-top: 6px; }
     table.lines { width: 100%; margin-top: 10px; }
     table.lines th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px; text-align: left; }
     table.lines td { padding: 2px 3px; }
     table.pie { width: 100%; margin-top: 20px; border: 1px solid #000; }
     table.pie th { border-bottom: 1px solid #000; padding: 3px; font-size: 8.5px; text-align: right; }
     table.pie td { padding: 3px; text-align: right; }`,
    `<div class="frame"><div class="h"><div><div class="n">${supplier.name.toUpperCase()}</div><div>CTRA. M-607 KM 45 · 28720 BUSTARVIEJO (MADRID)</div><div>C.I.F.: ${supplier.cif} · TFNO. 918 482 290</div></div>
       <div><div class="k">FACTURA: ${number}</div><div class="k">FECHA: ${dateEs(date)}</div><div class="k">CLIENTE: 000781 CAFETERIA EL MIRADOR</div></div></div></div>
     <table class="lines"><thead><tr><th>ARTICULO</th><th>DESCRIPCION</th><th class="r">CANT.</th><th class="r">PRECIO</th><th class="r">DTO.</th><th class="r">IMPORTE</th></tr></thead><tbody>${rows}</tbody></table>
     <table class="pie"><tr><th>IMP. BRUTO</th><th>DTO. P.P.</th><th>BASE IMPONIBLE</th><th>% IVA</th><th>CUOTA IVA</th><th>% R.E.</th><th>CUOTA R.E.</th><th>TOTAL FACTURA</th></tr>
       <tr><td>${fmt(totals.gross)}</td><td>0,00</td><td>${fmt(b[0].base)}</td><td>${fmt(b[0].rate)}</td><td>${fmt(b[0].vat)}</td><td>0,00</td><td>0,00</td><td></td></tr>
       <tr><td></td><td></td><td>${fmt(b[1].base)}</td><td>${fmt(b[1].rate)}</td><td>${fmt(b[1].vat)}</td><td>0,00</td><td>0,00</td><td class="b">${fmt(totals.total)}</td></tr></table>
     <p style="margin-top:10px">FORMA DE PAGO: RECIBO A 30 DIAS F.F. · SEGUN LEY 15/2010 DE MOROSIDAD</p>`,
  );
  return {
    id: 'inv12-lacteos-ean-pie-erp',
    features: ['códigos EAN-13', 'fuente monoespaciada en mayúsculas', 'pie horizontal de ERP: bruto | dto. p.p. | base | %IVA | cuota | %R.E. | cuota R.E. | total', 'dos tipos de IVA en filas del pie', 'descuentos por línea'],
    page: { format: 'A4', margin: '12mm' },
    html,
    expected: invoiceExpected({ id: 'inv12', features: [], supplier, number, date, lines, totals }),
  };
}

export const INVOICES = [inv01, inv02, inv03, inv04, inv05, inv06, inv07, inv08, inv09, inv10, inv11, inv12].map((f) => {
  const d = f();
  d.expected.id = d.id;
  d.expected.features = d.features;
  return d;
});

/** Facturas con variantes degradadas (foto y PDF escaneado) en el banco de pruebas. */
export const DEGRADED_INVOICES = ['inv02-carniceria-uds-kilos-lotes', 'inv03-pescados-fao', 'inv05-ticket-cash-carry', 'inv06-albaran-valorado', 'inv10-fruteria-codigos-iva-abono', 'inv12-lacteos-ean-pie-erp'];

export { descText };
