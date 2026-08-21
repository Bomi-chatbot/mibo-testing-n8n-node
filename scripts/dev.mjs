#!/usr/bin/env node
/** Development script for a repository-local n8n runtime. */

import { execFileSync, execSync, spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import {
  getLocalN8nPaths,
  getN8nEnvironment,
  N8N_INSTALL_GUIDANCE,
  restartAfterSuccessfulBuild,
  stopChildProcess,
  validateNodeRuntime,
} from './dev-local-utils.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = getLocalN8nPaths(ROOT);
validateNodeRuntime();
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
  },
});
const log = logger.child({ name: 'dev-local' });
const n8nLog = logger.child({ name: 'n8n' });

let n8nProcess = null;
let isBuilding = false;
let pendingRestart = false;

function build() {
  if (isBuilding) {
    pendingRestart = true;
    return false;
  }
  isBuilding = true;
  log.info('Building...');
  try {
    execSync('pnpm run build', { cwd: ROOT, stdio: 'pipe' });
    log.info('Build complete');
    return true;
  } catch (error) {
    log.error({ err: error.stdout?.toString() || error.message }, 'Build failed');
    return false;
  } finally {
    isBuilding = false;
  }
}

function getN8nVersion() {
  try {
    return execFileSync(paths.binary, ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(N8N_INSTALL_GUIDANCE);
    throw error;
  }
}

function startN8n() {
  stopChildProcess(n8nProcess);
  n8nProcess = null;
  let version;
  try {
    version = getN8nVersion();
  } catch (error) {
    log.error(error.message);
    log.error('Install n8n with `pnpm run dev:local:install`, then retry.');
    return false;
  }

  log.info({ version }, 'Starting repository-local n8n...');
  n8nProcess = spawn(paths.binary, ['start'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: getN8nEnvironment(paths),
  });
  n8nProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) n8nLog.info(line);
  });
  n8nProcess.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) n8nLog.warn(line);
  });
  n8nProcess.on('close', (code) => {
    if (code !== null && code !== 0) log.warn({ code }, 'n8n exited');
  });
  n8nProcess.on('error', (error) => log.error({ err: error }, 'Failed to start n8n'));
  return true;
}

function restart() {
  restartAfterSuccessfulBuild(build, () => {
    startN8n();
    log.info({ url: 'http://localhost:5678' }, 'n8n is running');
  });
  if (pendingRestart) {
    pendingRestart = false;
    setTimeout(restart, 100);
  }
}

function setupWatcher() {
  let debounceTimer = null;
  const onChange = (_eventType, filename) => {
    if (!filename || !filename.endsWith('.ts')) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      log.info({ file: filename }, 'Change detected');
      restart();
    }, 300);
  };
  for (const directory of [join(ROOT, 'nodes'), join(ROOT, 'credentials')]) {
    try {
      watch(directory, { recursive: true }, onChange);
      log.info({ directory }, 'Watching directory');
    } catch (error) {
      log.warn({ directory, err: error.message }, 'Could not watch directory');
    }
  }
}

function cleanup() {
  log.info('Shutting down...');
  stopChildProcess(n8nProcess);
  n8nProcess = null;
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
log.info('Mibo Testing n8n Node - Local Dev');
log.info({ runtime: paths.runtime, profile: paths.profile }, 'Using isolated local paths');

if (build() && startN8n()) {
  setupWatcher();
  log.info({ url: 'http://localhost:5678' }, 'n8n is running');
  log.info('Watching for changes... (Ctrl+C to stop)');
} else {
  log.error('Initial build or n8n startup failed. Fix it and retry.');
  process.exit(1);
}
