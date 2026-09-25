import { runnerImport } from 'vite';
import fs from 'node:fs';
const root = '/home/user/trading-system/escandallo-pro';
const { module: mu } = await runnerImport(root + '/src/extract/menuUtils.ts', { root, configFile: false, logLevel: 'error' });
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const psm = process.argv[3], src = process.argv[4];
console.log('skew', mu.estimateSkew(data[psm][src]));
const streams = mu.boxesToStreams(data[psm][src]);
streams.forEach((s, i) => { console.log('== stream', i); for (const r of s) console.log(JSON.stringify(r)); });
