import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function copyIcons(srcRoot, distRoot, dir = srcRoot, relativePath = '') {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const srcPath = join(dir, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyIcons(srcRoot, distRoot, srcPath, join(relativePath, entry));
    } else if (entry.endsWith('.svg') || entry.endsWith('.png')) {
      const destPath = join(distRoot, relativePath, entry);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      console.log(`Copied: ${join(relativePath, entry)}`);
    }
  }
}

console.log('Copying icons to dist...');
copyIcons(join(rootDir, 'nodes'), join(rootDir, 'dist', 'nodes'));
copyIcons(join(rootDir, 'credentials'), join(rootDir, 'dist', 'credentials'));
console.log('Done!');
