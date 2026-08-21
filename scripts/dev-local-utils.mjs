import { join } from 'node:path';

export const N8N_INSTALL_GUIDANCE =
  'Local n8n is not installed. Run `pnpm run dev:local:install` and retry.';
export const LOCAL_NATIVE_BUILD_DEPENDENCIES = ['isolated-vm', 'sqlite3'];

export function getLocalN8nPaths(root) {
  const localN8n = join(root, '.local', 'n8n');
  const runtime = join(localN8n, 'runtime');

  return {
    localN8n,
    runtime,
    profile: join(localN8n, 'profile'),
    binary: join(runtime, 'node_modules', '.bin', 'n8n'),
    extensions: root,
  };
}

export function getN8nEnvironment(paths, environment = process.env) {
  return {
    ...environment,
    N8N_USER_FOLDER: paths.profile,
    N8N_CUSTOM_EXTENSIONS: paths.extensions,
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_LOG_LEVEL: 'info',
    N8N_HOST: 'localhost',
    N8N_PORT: '5678',
    N8N_PROTOCOL: 'http',
  };
}

export function getInstallCommand() {
  return ['add', '--dir', '.local/n8n/runtime', 'n8n@latest', '--save-exact'];
}

export function stopChildProcess(childProcess) {
  if (childProcess && !childProcess.killed) childProcess.kill('SIGTERM');
}

export function shouldRestartAfterBuild(buildSucceeded) {
  return buildSucceeded === true;
}

export function validateNodeRuntime(version = process.versions.node) {
  const majorVersion = Number.parseInt(version.split('.')[0], 10);
  if (majorVersion !== 22) {
    throw new Error(
      `Local n8n development requires Node.js 22.22.0; active version is ${version}. Run ` +
        '`mise install` and open a shell with mise activated.',
    );
  }
}

export function restartAfterSuccessfulBuild(build, restart) {
  if (shouldRestartAfterBuild(build())) restart();
}
