import { runnerImport } from 'vite';
import fs from 'node:fs';
const root = '/home/user/trading-system/escandallo-pro';
const { module: mu } = await runnerImport(root + '/src/extract/menuUtils.ts', { root, configFile: false, logLevel: 'error' });
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log('psm', d.psm, 'skew', mu.estimateSkew(d.words).toFixed(4));
for (const s of mu.boxesToStreams(d.words)) { console.log('== stream'); for (const r of s) console.log(`${(r.gap ?? -1).toFixed(2).padStart(6)} ${r.size.toFixed(1).padStart(5)}  ${r.text}`); }
