#!/usr/bin/env node
/**
 * Membuat ZIP extension SMGE Toolkit yang dilayani dashboard (apps/dashboard/public/downloads/smge-extension.zip).
 * Hanya berkas runtime; tes dan sumber lain tidak ikut. Lintas platform: `zip` di macOS/Linux, Compress-Archive di Windows.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const source = resolve(root, 'infrastructure/smge-extension');
const outDir = resolve(root, 'apps/dashboard/public/downloads');
const target = resolve(outDir, 'smge-extension.zip');
const FILES = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'worker.js',
  'page.js',
  'native-input.js',
  'collector.js',
].map((f) => resolve(source, f));

mkdirSync(outDir, { recursive: true });
rmSync(target, { force: true });
if (process.platform === 'win32') {
  const list = FILES.map((f) => `'${f}'`).join(',');
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -LiteralPath ${list} -DestinationPath '${target}' -Force`,
  ]);
} else {
  execFileSync('zip', ['-qjX', target, ...FILES]);
}
console.log(`Dibuat: ${target}`);
