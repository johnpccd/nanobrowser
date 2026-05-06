import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');
const buildSha1 = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

export default withPageConfig({
  resolve: {
    alias: {
      '@src': srcDir,
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'options'),
  },
  define: {
    __BUILD_SHA1__: JSON.stringify(buildSha1),
  },
});
