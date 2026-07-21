import test from 'node:test';import assert from 'node:assert/strict';import { spawn } from 'node:child_process';
const port=3199;let proc;
test.before(async()=>{proc=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});for(let i=0;i<20;i++){try{await fetch(`http://localhost:${port}/api/dashboard`);return}catch{await new Promise(r=>setTimeout(r,50))}}throw new Error('Servidor não iniciou')});
test.after(()=>proc?.kill());
test('dashboard retorna estrutura completa',async()=>{const r=await fetch(`http://localhost:${port}/api/dashboard`);assert.equal(r.status,200);const d=await r.json();assert.ok(d.metrics);assert.ok(Array.isArray(d.members));assert.ok(Array.isArray(d.events))});
test('arquivos fora da pasta pública são bloqueados',async()=>{const r=await fetch(`http://localhost:${port}/..%2Fpackage.json`);assert.notEqual(r.status,200)});
test('página pública de oferta está disponível',async()=>{const r=await fetch(`http://localhost:${port}/oferta`);assert.equal(r.status,200);const html=await r.text();assert.match(html,/R\$<\/sup><b>19/);assert.match(html,/Vitalício/)});
