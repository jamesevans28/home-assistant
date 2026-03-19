/**
 * Patches vscode-jsonrpc to add an "exports" map.
 * The @github/copilot-sdk imports "vscode-jsonrpc/node" but the package
 * lacks an exports field, so Node's ESM resolver can't find it.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'node_modules', 'vscode-jsonrpc', 'package.json');

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (!pkg.exports) {
    pkg.exports = {
      '.': './lib/node/main.js',
      './node': './node.js',
      './browser': './browser.js',
      './*': './*'
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
    console.log('Patched vscode-jsonrpc package.json with exports map');
  }
} catch (e) {
  // Silently skip if package not found (e.g. in CI without copilot-sdk)
}
