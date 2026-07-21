import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/assets', { recursive: true });
await cp('public', 'dist/assets', { recursive: true });
await cp('site-worker.mjs', 'dist/server/index.js');
console.log('Site preparado em dist/');
