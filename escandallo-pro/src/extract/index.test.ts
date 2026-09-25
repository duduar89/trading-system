import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ExtractedInvoice, ExtractedMenu, ProgressInfo } from '../types';
import type { PdfTextLine } from './pdf';

const m = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
  pdfToImages: vi.fn(),
  ocrInvoiceImages: vi.fn(),
  ocrMenuImages: vi.fn(),
  preprocessImage: vi.fn(),
  aiExtractInvoice: vi.fn(),
  aiExtractMenu: vi.fn(),
  readSpreadsheet: vi.fn(),
  guessColumnMapping: vi.fn(),
  sheetToInvoices: vi.fn(),
  parseMenuText: vi.fn(),
  mergeMenuPasses: vi.fn((menus: ExtractedMenu[]) => menus[0]),
  menuQuality: vi.fn(() => 1),
}));

vi.mock('./pdf', () => ({ extractPdfText: m.extractPdfText, pdfToImages: m.pdfToImages }));
vi.mock('./ocr', () => ({ ocrInvoiceImages: m.ocrInvoiceImages, ocrMenuImages: m.ocrMenuImages, preprocessImage: m.preprocessImage }));
vi.mock('../ai/invoice', () => ({ aiExtractInvoice: m.aiExtractInvoice }));
vi.mock('../ai/menu', () => ({ aiExtractMenu: m.aiExtractMenu }));
vi.mock('./spreadsheet', () => ({ readSpreadsheet: m.readSpreadsheet, guessColumnMapping: m.guessColumnMapping, sheetToInvoices: m.sheetToInvoices }));
vi.mock('./menuParser', () => ({ parseMenuText: m.parseMenuText, mergeMenuPasses: m.mergeMenuPasses, menuQuality: m.menuQuality }));

const { aiAvailable, dedupeMenuEntries, extractInvoicesFromFile, extractMenuFromFiles, fileKind, parseInvoicePages } = await import('./index');
const { AIError } = await import('../ai/client');

// ───────────────────────────── Datos ─────────────────────────────

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ id: 'app', aiModel: 'claude-sonnet-5', aiEffort: 'medium', aiEnabled: false, theme: 'system', onboardingDone: true, ...over });
const withAi = settings({ aiEnabled: true, apiKey: 'sk-ant-prueba' });

const file = (name: string, type: string, bytes: number[] = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type });
const pdfFile = () => file('factura.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]);
const jpgFile = (name = 'foto.jpg') => file(name, 'image/jpeg', [0xff, 0xd8, 0xff, 0xe0]);

/** Filas posicionales de pdf.js a partir de texto (celdas separadas por 2+ espacios). */
function pdfLines(text: string, page = 1): PdfTextLine[] {
  return text.split('\n').map((line, i) => {
    const items: PdfTextLine['items'] = [];
    const re = /\S+(?: \S+)*/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(line))) items.push({ x: mm.index * 5, width: mm[0].length * 5, str: mm[0] });
    return { page, y: i * 12, text: line, items };
  });
}

const invoiceText = (number: string, desc = 'SOLOMILLO DE TERNERA', qty = '2,000', price = '30,00', total = '60,00') =>
  [
    'CARNES SELECTAS S.L.',
    'CIF B12345674',
    `Nº Factura: ${number}        Fecha: 01/09/2026`,
    'Descripción                    Cantidad   Ud.    Precio    Importe',
    `${desc}           ${qty}     KG     ${price}     ${total}`,
    `Base imponible   ${total}`,
  ].join('\n');

const textPdf = (text: string) => {
  const lines = pdfLines(text);
  return { pageCount: 1, lines, text, hasText: true };
};

const ocrInvoice = (over: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
  supplierName: 'OCR S.L.',
  lines: [{ description: 'TOMATE', quantity: 2, unit: 'kg', unitPrice: 1, total: 2, confidence: 1 }],
  method: 'ocr',
  warnings: [],
  ...over,
});

const aiInvoice: ExtractedInvoice = { supplierName: 'IA S.L.', lines: [{ description: 'PAN', quantity: 1, unit: 'ud', unitPrice: 1, total: 1 }], method: 'ia', warnings: [] };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.mergeMenuPasses.mockImplementation((menus: ExtractedMenu[]) => menus[0]);
  m.menuQuality.mockReturnValue(1);
  m.ocrInvoiceImages.mockResolvedValue({ invoice: ocrInvoice(), ocr: { text: 'texto', confidence: 90, lines: [] }, passes: [] });
  m.pdfToImages.mockResolvedValue([new Blob(['png'])]);
  m.preprocessImage.mockImplementation(async (b: Blob) => b);
});

// ───────────────────────────── Tests ─────────────────────────────

describe('utilidades', () => {
  it('fileKind por tipo y extensión', () => {
    expect(fileKind({ name: 'a.PDF' })).toBe('pdf');
    expect(fileKind({ type: 'image/heic' })).toBe('image');
    expect(fileKind({ name: 'foto.heic' })).toBe('image');
    expect(fileKind({ name: 'tarifa.xlsx' })).toBe('sheet');
    expect(fileKind({ name: 'lista.csv' })).toBe('sheet');
    expect(fileKind({ name: 'nota.docx' })).toBe('unknown');
  });

  it('la IA sólo está disponible si el usuario la ha activado con su clave', () => {
    expect(aiAvailable(settings())).toBe(false);
    expect(aiAvailable(settings({ aiEnabled: true }))).toBe(false);
    expect(aiAvailable(settings({ apiKey: 'x' }))).toBe(false);
    expect(aiAvailable(withAi)).toBe(true);
  });
});

describe('extractInvoicesFromFile · PDF', () => {
  it('PDF con texto: lectura local gratuita sin OCR ni IA', async () => {
    m.extractPdfText.mockResolvedValue(textPdf(invoiceText('F-1')));
    const events: ProgressInfo[] = [];
    const [inv] = await extractInvoicesFromFile(pdfFile(), { settings: settings(), onProgress: (p) => events.push(p) });
    expect(inv.method).toBe('pdf-texto');
    expect(inv.number).toBe('F-1');
    expect(inv.lines[0]).toMatchObject({ quantity: 2, unitPrice: 30, total: 60, unit: 'kg' });
    expect(m.aiExtractInvoice).not.toHaveBeenCalled();
    expect(m.ocrInvoiceImages).not.toHaveBeenCalled();
    expect(events.some((e) => e.stage === 'Interpretando líneas…')).toBe(true);
    const values = events.map((e) => e.progress ?? 0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  });

  it('PDF escaneado: renderiza las páginas a ~300 ppp y usa el OCR', async () => {
    m.extractPdfText.mockResolvedValue({ pageCount: 1, lines: [], text: '', hasText: false });
    const [inv] = await extractInvoicesFromFile(pdfFile(), { settings: settings() });
    expect(inv.method).toBe('ocr');
    expect(m.pdfToImages.mock.calls[0][1]).toMatchObject({ scale: 300 / 72, maxSide: 3300 });
    expect(m.ocrInvoiceImages).toHaveBeenCalled();
  });

  it('capa de texto sin tabla: prueba el OCR y se queda con la mejor lectura', async () => {
    m.extractPdfText.mockResolvedValue(textPdf('Documento escaneado con cabecera de texto\nPágina 1 de 1 · Gracias por su confianza, vuelva pronto'));
    const [inv] = await extractInvoicesFromFile(pdfFile(), { settings: settings() });
    expect(m.ocrInvoiceImages).toHaveBeenCalled();
    expect(inv.method).toBe('ocr');
  });

  it('IA activada y disponible: usa la IA', async () => {
    m.aiExtractInvoice.mockResolvedValue(aiInvoice);
    const res = await extractInvoicesFromFile(pdfFile(), { settings: withAi });
    expect(res).toEqual([aiInvoice]);
    expect(m.extractPdfText).not.toHaveBeenCalled();
  });

  it('si la IA falla, cae a la lectura local e indica el motivo', async () => {
    m.aiExtractInvoice.mockRejectedValue(new AIError('auth', 'La clave de API no es válida'));
    m.extractPdfText.mockResolvedValue(textPdf(invoiceText('F-2')));
    const [inv] = await extractInvoicesFromFile(pdfFile(), { settings: withAi });
    expect(inv.method).toBe('pdf-texto');
    expect(inv.warnings[0]).toBe('La IA no estaba disponible (La clave de API no es válida); se ha usado lectura local');
  });

  it('forceLocal nunca llama a la IA; una cancelación no se oculta', async () => {
    m.extractPdfText.mockResolvedValue(textPdf(invoiceText('F-3')));
    await extractInvoicesFromFile(pdfFile(), { settings: withAi, forceLocal: true });
    expect(m.aiExtractInvoice).not.toHaveBeenCalled();
    m.aiExtractInvoice.mockRejectedValue(new DOMException('Cancelado', 'AbortError'));
    await expect(extractInvoicesFromFile(pdfFile(), { settings: withAi })).rejects.toThrow('Cancelado');
  });

  it('un PDF con varias facturas devuelve una por número de factura', () => {
    const lines = [...pdfLines(invoiceText('A-1'), 1), ...pdfLines(invoiceText('A-2', 'LOMO ALTO DE VACA', '1,500', '20,00', '30,00'), 2)];
    const res = parseInvoicePages(lines, 'pdf-texto');
    expect(res.map((i) => [i.number, i.lines.length, i.subtotal])).toEqual([
      ['A-1', 1, 60],
      ['A-2', 1, 30],
    ]);
    // Dos páginas de la MISMA factura: una sola
    const same = parseInvoicePages([...pdfLines(invoiceText('B-7'), 1), ...pdfLines('Suma anterior\nPÁGINA 2', 2)], 'pdf-texto');
    expect(same).toHaveLength(1);
  });
});

describe('extractInvoicesFromFile · fotos, hojas y errores', () => {
  it('foto: OCR local con aviso si la imagen se lee con dificultad', async () => {
    m.ocrInvoiceImages.mockResolvedValue({ invoice: ocrInvoice(), ocr: { text: 'x', confidence: 42, lines: [] }, passes: [] });
    const [inv] = await extractInvoicesFromFile(jpgFile(), { settings: settings() });
    expect(inv.method).toBe('ocr');
    expect(inv.warnings.some((w) => w.includes('se lee con dificultad'))).toBe(true);
    expect(m.preprocessImage).not.toHaveBeenCalled();
  });

  it('foto con IA: la prepara (EXIF, tamaño) antes de enviarla', async () => {
    m.aiExtractInvoice.mockResolvedValue(aiInvoice);
    await extractInvoicesFromFile(jpgFile(), { settings: withAi });
    expect(m.preprocessImage).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ maxSide: 2000, mime: 'image/jpeg' }));
    expect(m.aiExtractInvoice.mock.calls[0].slice(1, 3)).toEqual(['image/jpeg', withAi]);
  });

  it('HEIC no compatible: mensaje claro', async () => {
    m.ocrInvoiceImages.mockRejectedValue(new Error('Formato HEIC no compatible en este navegador: expórtala como JPG'));
    await expect(extractInvoicesFromFile(file('IMG_0001.HEIC', 'image/heic'), { settings: settings() })).rejects.toThrow(/HEIC/);
  });

  it('hoja de cálculo: una factura por grupo, sin IA', async () => {
    const inv = (n: string): ExtractedInvoice => ({ number: n, lines: [{ description: 'X', quantity: 1, unit: 'ud', unitPrice: 1, total: 1 }], method: 'hoja', warnings: [] });
    m.readSpreadsheet.mockResolvedValue([{ name: 'Hoja1', rows: [['Descripción', 'Importe'], ['X', 1]] }]);
    m.guessColumnMapping.mockReturnValue({ headerRow: 0, mapping: { description: 0, total: 1 }, confidence: 0.9 });
    m.sheetToInvoices.mockReturnValue([inv('1'), inv('2'), { ...inv('3'), lines: [] }]);
    const res = await extractInvoicesFromFile(file('compras.xlsx', ''), { settings: withAi });
    expect(res.map((i) => i.number)).toEqual(['1', '2']);
    expect(m.aiExtractInvoice).not.toHaveBeenCalled();
  });

  it('hoja sin líneas reconocibles: error claro', async () => {
    m.readSpreadsheet.mockResolvedValue([{ name: 'Hoja1', rows: [[null, 'a']] }]);
    m.guessColumnMapping.mockReturnValue({ headerRow: 0, mapping: { description: -1 }, confidence: 0 });
    await expect(extractInvoicesFromFile(file('vacia.csv', 'text/csv'), { settings: settings() })).rejects.toThrow(/No se han encontrado líneas/);
  });

  it('formato desconocido o archivo vacío', async () => {
    await expect(extractInvoicesFromFile(file('nota.docx', 'application/msword'), { settings: settings() })).rejects.toThrow(/Formato no admitido/);
    await expect(extractInvoicesFromFile(file('vacio.pdf', 'application/pdf', []), { settings: settings() })).rejects.toThrow(/vacío/);
  });

  it('sin nombre ni tipo: detecta el formato por la firma del archivo', async () => {
    m.extractPdfText.mockResolvedValue(textPdf(invoiceText('F-9')));
    const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])]);
    const [inv] = await extractInvoicesFromFile(blob, { settings: settings() });
    expect(inv.number).toBe('F-9');
  });
});

describe('extractMenuFromFiles', () => {
  const menu = (names: string[], method: ExtractedMenu['method'] = 'ocr'): ExtractedMenu => ({
    entries: names.map((name, i) => ({ name, price: 10 + i, confidence: 0.9 })),
    method,
    warnings: [],
  });

  it('fotos: OCR local con el parser de cartas y sin duplicados', async () => {
    const ocr = { text: 'texto', confidence: 88, lines: [], words: [{ text: 'Croquetas', confidence: 90, bbox: { x0: 0, y0: 0, x1: 90, y1: 20 }, page: 1, line: 1, block: 0 }] };
    m.ocrMenuImages.mockImplementation(async (_imgs: Blob[], parse: (t: string, o: typeof ocr) => ExtractedMenu) => ({ menu: parse('texto', ocr), ocr, passes: [] }));
    m.parseMenuText.mockReturnValue(menu(['Croquetas de jamón', 'CROQUETAS DE JAMÓN', 'Pulpo a la gallega']));
    const res = await extractMenuFromFiles([jpgFile('a.jpg'), jpgFile('b.jpg')], { settings: settings() });
    // El parser recibe también las cajas de las palabras (precios alineados a la derecha, fotos giradas)
    expect(m.parseMenuText).toHaveBeenCalledWith('texto', 'ocr', [{ text: 'Croquetas', confidence: 90, bbox: { x0: 0, y0: 0, x1: 90, y1: 20 }, page: 1 }]);
    expect(m.ocrMenuImages.mock.calls[0][3]).toMatchObject({ merge: m.mergeMenuPasses, quality: m.menuQuality });
    expect(res.method).toBe('ocr');
    expect(res.entries.map((e) => e.name)).toEqual(['Croquetas de jamón', 'Pulpo a la gallega']);
  });

  it('PDF de carta con texto: lo lee directamente (sin OCR)', async () => {
    m.extractPdfText.mockResolvedValue(textPdf('ENTRANTES\nCroquetas   9,50'));
    m.parseMenuText.mockReturnValue(menu(['Croquetas'], 'pdf-texto'));
    const res = await extractMenuFromFiles([pdfFile()], { settings: settings() });
    expect(m.parseMenuText).toHaveBeenCalledWith(expect.stringContaining('Croquetas'), 'pdf-texto');
    expect(m.ocrMenuImages).not.toHaveBeenCalled();
    expect(res.method).toBe('pdf-texto');
  });

  it('IA que falla: aviso y lectura local', async () => {
    m.aiExtractMenu.mockRejectedValue(new AIError('network', 'Sin conexión'));
    m.ocrMenuImages.mockResolvedValue({ menu: menu(['Bravas']), ocr: { text: 'Bravas 6,50', confidence: 90, lines: [] }, passes: [] });
    const res = await extractMenuFromFiles([jpgFile()], { settings: withAi });
    expect(res.warnings).toContain('La IA no estaba disponible (Sin conexión); se ha usado lectura local');
    expect(res.entries).toHaveLength(1);
  });

  it('IA disponible: usa la visión de la IA', async () => {
    m.aiExtractMenu.mockResolvedValue(menu(['Tarta', 'Tarta'], 'ia'));
    const res = await extractMenuFromFiles([jpgFile()], { settings: withAi });
    expect(res.method).toBe('ia');
    expect(res.entries).toHaveLength(1);
  });

  it('errores claros sin fotos o con formatos no admitidos', async () => {
    await expect(extractMenuFromFiles([], { settings: settings() })).rejects.toThrow(/al menos una foto/);
    await expect(extractMenuFromFiles([file('carta.docx', 'application/msword')], { settings: settings() })).rejects.toThrow(/Formato no admitido/);
  });

  it('dedupeMenuEntries se queda con la entrada más completa', () => {
    const res = dedupeMenuEntries([
      { name: 'Pulpo a la gallega', confidence: 0.5 },
      { name: 'PULPO A LA GALLEGA', price: 18, section: 'Entrantes', confidence: 0.9 },
    ]);
    expect(res).toEqual([{ name: 'PULPO A LA GALLEGA', price: 18, section: 'Entrantes', confidence: 0.9 }]);
  });
});
