// `npm start` (Azure App Service runs this). An earlier Azure (Oryx) build left
// node_modules.tar.zst + oryx-manifest.toml in the app folder; at every startup Azure unpacks
// that archive to /node_modules, moves our node_modules to _del_node_modules and links
// node_modules -> /node_modules, which breaks the npm workspace links. Undo that, delete the
// leftovers so it stops, then start the server. Locally none of this exists and it just starts.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

for (const f of ['node_modules.tar.zst', 'oryx-manifest.toml']) rmSync(f, { force: true });

if (lstatSync('node_modules', { throwIfNoEntry: false })?.isSymbolicLink()) {
  // `mv node_modules _del_node_modules` nests it if _del_node_modules already existed.
  const ours = ['_del_node_modules/node_modules', '_del_node_modules'].find((d) => existsSync(`${d}/@ghost`));
  if (ours) {
    unlinkSync('node_modules');
    renameSync(ours, 'node_modules');
    console.log(`[start] restored node_modules from ${ours}`);
  }
}
rmSync('_del_node_modules', { recursive: true, force: true });

const run = (args) =>
  new Promise((done) => spawn('npm', args, { stdio: 'inherit', shell: true }).on('exit', (code) => done(code ?? 1)));

// Last resort: if the libraries are gone (a dangling link to a wiped /node_modules), reinstall them.
if (!existsSync('node_modules/tsx/package.json')) {
  console.log('[start] node_modules missing, running npm ci');
  if (lstatSync('node_modules', { throwIfNoEntry: false })) rmSync('node_modules', { recursive: true, force: true });
  const code = await run(['ci', '--no-audit', '--no-fund']);
  if (code) process.exit(code);
}

process.exit(await run(['start', '-w', '@ghost/server']));
