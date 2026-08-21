#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getInstallCommand,
  getLocalN8nPaths,
  LOCAL_NATIVE_BUILD_DEPENDENCIES,
} from './dev-local-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = getLocalN8nPaths(root);

mkdirSync(paths.runtime, { recursive: true });
const runtimePackageJson = join(paths.runtime, 'package.json');
const runtimePackage = existsSync(runtimePackageJson)
  ? JSON.parse(readFileSync(runtimePackageJson, 'utf8'))
  : { name: 'mibo-local-n8n-runtime', private: true };
runtimePackage.pnpm = {
  ...runtimePackage.pnpm,
  onlyBuiltDependencies: [
    ...new Set([
      ...(runtimePackage.pnpm?.onlyBuiltDependencies || []),
      ...LOCAL_NATIVE_BUILD_DEPENDENCIES,
    ]),
  ],
};
writeFileSync(runtimePackageJson, `${JSON.stringify(runtimePackage, null, 2)}\n`);
execFileSync('pnpm', getInstallCommand(), { cwd: root, stdio: 'inherit' });
execFileSync('pnpm', ['rebuild', ...LOCAL_NATIVE_BUILD_DEPENDENCIES], {
  cwd: root,
  stdio: 'inherit',
});
