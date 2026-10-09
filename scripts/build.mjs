import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPresentations } from './manifest.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function build({ root = projectRoot } = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));
  if (typeof config.title !== 'string' || !config.title.trim() || typeof config.description !== 'string') {
    throw new Error('site.config.json needs a title and description.');
  }
  const scanned = await scanPresentations({ root, pdfDirectory: config.pdfDirectory });
  const output = path.resolve(root, 'dist');
  if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== 'dist') {
    throw new Error('Refusing to clear an output directory outside this project.');
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(path.join(root, 'index.html'), path.join(output, 'index.html'));
  await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
  const pdfjsSource = path.join(projectRoot, 'node_modules', 'pdfjs-dist');
  const pdfjsTarget = path.join(output, 'assets', 'vendor', 'pdfjs');
  await mkdir(pdfjsTarget, { recursive: true });
  for (const filename of ['pdf.mjs', 'pdf.worker.mjs']) {
    await cp(path.join(pdfjsSource, 'build', filename), path.join(pdfjsTarget, filename));
  }
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    await cp(path.join(pdfjsSource, directory), path.join(pdfjsTarget, directory), { recursive: true });
  }
  await cp(path.join(pdfjsSource, 'web', 'pdf_viewer.css'), path.join(pdfjsTarget, 'pdf_viewer.css'));
  await cp(path.join(pdfjsSource, 'web', 'images'), path.join(pdfjsTarget, 'images'), { recursive: true });
  await cp(path.join(pdfjsSource, 'LICENSE'), path.join(pdfjsTarget, 'LICENSE'));
  const pdfLibTarget = path.join(output, 'assets', 'vendor', 'pdf-lib');
  await mkdir(pdfLibTarget, { recursive: true });
  await cp(path.join(projectRoot, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.esm.min.js'), path.join(pdfLibTarget, 'pdf-lib.mjs'));
  await cp(path.join(projectRoot, 'node_modules', 'pdf-lib', 'LICENSE.md'), path.join(pdfLibTarget, 'LICENSE.md'));
  for (const presentation of scanned) {
    const destination = path.join(output, ...presentation.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, presentation.sourceRelative), destination);
  }
  const manifest = {
    version: 1,
    title: config.title,
    description: config.description,
    pdfDirectory: config.pdfDirectory.replaceAll('\\', '/'),
    generatedAt: new Date().toISOString(),
    presentations: scanned.map(({ sourceRelative, ...publicData }) => publicData)
  };
  await writeFile(path.join(output, 'presentations.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(output, '.nojekyll'), '');
  console.log(`Built ${scanned.length} presentation${scanned.length === 1 ? '' : 's'} into ${output}`);
  return { output, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(error => { console.error(error.message); process.exitCode = 1; });
}
