// Builds vendor/clipper.js from Obsidian Web Clipper's source, so clipping uses the
// Clipper's own template engine and Markdown converter.
//
//   node scripts/build_clipper.mjs <obsidian-clipper source> <folder with node_modules>
//
// The second folder needs: npm i knap@0.6.0 defuddle@0.19.2 dayjs esbuild mathml-to-latex@1.8.0 turndown temml
// (the last two only for their license notices: Defuddle's build includes them).
// It lives outside the extension, as Chrome refuses an unpacked extension whose
// node_modules holds `_`-prefixed files.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [clipperRoot, depsRoot] = process.argv.slice(2).map((p) => p && path.resolve(p));
if (!clipperRoot || !depsRoot) {
  console.error('usage: node scripts/build_clipper.mjs <obsidian-clipper source> <folder with node_modules>');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(depsRoot, 'package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: [path.join(here, 'clipper-entry.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  platform: 'browser',
  minify: true,
  legalComments: 'eof',
  outfile: path.join(here, '..', 'vendor', 'clipper.js'),
  nodePaths: [path.join(depsRoot, 'node_modules')],
  alias: {
    clipper: path.join(clipperRoot, 'src'),
    'webextension-polyfill': path.join(clipperRoot, 'src/utils/cli-stubs.ts'),
  },
  define: { DEBUG_MODE: 'false' },
  banner: { js: '// Obsidian Web Clipper template pipeline (MIT, Obsidian), with knap and Defuddle (MIT). Built by scripts/build_clipper.mjs.' },
  logLevel: 'info',
  metafile: true,
}).then(async ({ metafile }) => {
  // MIT and similar licenses ask for their notices to travel with the code.
  const { readFile, writeFile, readdir } = await import('node:fs/promises');
  const packages = new Map([['obsidian-clipper', clipperRoot]]);
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) packages.set(m[1], input.slice(0, input.indexOf(m[0]) + m[0].length));
  }
  // Defuddle's full build has these compiled into it.
  for (const name of ['turndown', 'temml']) packages.set(`${name} (inside defuddle)`, path.join(depsRoot, 'node_modules', name));
  const sections = [];
  for (const [name, dir] of [...packages].sort()) {
    const base = path.isAbsolute(dir) ? dir : path.resolve(dir);
    const file = (await readdir(base)).find((f) => /^licen[cs]e/i.test(f));
    sections.push(`${name}\n${'='.repeat(name.length)}\n${file ? (await readFile(path.join(base, file), 'utf8')).trim() : 'License file not found; see the package.'}\n`);
  }
  await writeFile(path.join(here, '..', 'vendor', 'THIRD_PARTY_LICENSES.txt'), `Third-party code in vendor/clipper.js\n\n${sections.join('\n')}`);
});
