import { runnerImport } from 'vite';
import fs from 'node:fs';
const root = '/home/user/trading-system/escandallo-pro';
const { module: mp } = await runnerImport(root + '/src/extract/menuParser.ts', { root, configFile: false, logLevel: 'error' });
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = process.argv[3] ?? 'all';
for (const psm of Object.keys(data)) {
  for (const src of ['text', 'words', 'lines']) {
    if (mode !== 'all' && mode !== src) continue;
    const r = src === 'text' ? mp.parseMenuText(data[psm].text, 'ocr') : mp.parseMenuText(data[psm].text, 'ocr', data[psm][src]);
    console.log(`--- PSM ${psm} / ${src}: ${r.entries.length} entries`);
    for (const e of r.entries) console.log(`  [${e.section ?? '-'}] ${e.name} | ${e.price ?? '—'} | ${e.description ?? ''} | ${e.confidence}`);
    if (r.warnings.length) console.log('  W:', r.warnings.join(' / '));
  }
}
