import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const executable = join(root, 'node_modules', 'n8n', 'bin', 'n8n');
const env = {
  ...process.env,
  N8N_HOST: '127.0.0.1',
  N8N_PORT: process.env.N8N_PORT || '5678',
  N8N_PROTOCOL: 'http',
  N8N_USER_FOLDER: join(root, 'data', 'n8n'),
  GENERIC_TIMEZONE: 'America/Sao_Paulo',
  TZ: 'America/Sao_Paulo',
  N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY || process.env.ADMIN_TOKEN
};

if (!env.N8N_ENCRYPTION_KEY) throw new Error('Configure N8N_ENCRYPTION_KEY ou ADMIN_TOKEN no .env');

const commandArgs = process.argv.slice(2);
const child = spawn(process.execPath, [executable, ...(commandArgs.length ? commandArgs : ['start'])], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
