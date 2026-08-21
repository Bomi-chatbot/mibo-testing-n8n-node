import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  getInstallCommand,
  getLocalN8nPaths,
  getN8nEnvironment,
  LOCAL_NATIVE_BUILD_DEPENDENCIES,
  N8N_INSTALL_GUIDANCE,
  restartAfterSuccessfulBuild,
  stopChildProcess,
  validateNodeRuntime,
} from '../scripts/dev-local-utils.mjs';

describe('local n8n development utilities', () => {
  it('resolves isolated runtime, profile, binary, and extension paths', () => {
    const paths = getLocalN8nPaths('/workspace/project');

    expect(paths.runtime).toBe(join('/workspace/project', '.local', 'n8n', 'runtime'));
    expect(paths.profile).toBe(join('/workspace/project', '.local', 'n8n', 'profile'));
    expect(paths.binary).toBe(
      join('/workspace/project', '.local', 'n8n', 'runtime', 'node_modules', '.bin', 'n8n'),
    );
    expect(paths.extensions).toBe('/workspace/project');
  });

  it('uses the local profile and repository extension path in n8n environment', () => {
    const paths = getLocalN8nPaths('/workspace/project');
    const environment = getN8nEnvironment(paths, { KEEP: 'yes' });

    expect(environment).toMatchObject({
      KEEP: 'yes',
      N8N_USER_FOLDER: paths.profile,
      N8N_CUSTOM_EXTENSIONS: '/workspace/project',
      N8N_DIAGNOSTICS_ENABLED: 'false',
    });
  });

  it('provides latest-install and missing-install recovery guidance', () => {
    expect(getInstallCommand()).toEqual([
      'add',
      '--dir',
      '.local/n8n/runtime',
      'n8n@latest',
      '--save-exact',
    ]);
    expect(N8N_INSTALL_GUIDANCE).toContain('pnpm run dev:local:install');
    expect(LOCAL_NATIVE_BUILD_DEPENDENCIES).toEqual(['isolated-vm', 'sqlite3']);
  });

  it('restarts after a successful build but not after a failed build', () => {
    const build = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const restart = vi.fn();

    restartAfterSuccessfulBuild(build, restart);
    restartAfterSuccessfulBuild(build, restart);

    expect(build).toHaveBeenCalledTimes(2);
    expect(restart).toHaveBeenCalledOnce();
  });

  it('accepts Node 22 and rejects incompatible local n8n runtimes', () => {
    expect(() => validateNodeRuntime('22.22.0')).not.toThrow();
    expect(() => validateNodeRuntime('24.16.0')).toThrow('requires Node.js 22.22.0');
  });

  it('terminates a running child process and tolerates an absent process', () => {
    const childProcess = { killed: false, kill: vi.fn() };

    stopChildProcess(childProcess);
    stopChildProcess(null);

    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
