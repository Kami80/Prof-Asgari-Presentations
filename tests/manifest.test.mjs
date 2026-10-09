import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPresentations, resolvePdfDirectory } from '../scripts/manifest.mjs';
import { build } from '../scripts/build.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'presentation-shelf-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'presentations', 'Week 02'), { recursive: true });
  return root;
}

test('discovers PDFs recursively, handles special names, and ignores unrelated files', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'presentations', 'Intro_to_AI.pdf'), '%PDF-1.7\nfixture');
  await writeFile(path.join(root, 'presentations', 'Week 02', 'درس #1 & review.PDF'), '%PDF-1.7\nfixture');
  await writeFile(path.join(root, 'presentations', 'notes.txt'), 'not a PDF');
  await writeFile(path.join(root, 'presentations', '.hidden.pdf'), '%PDF-1.7\nhidden');
  const files = await scanPresentations({ root, pdfDirectory: 'presentations', gitDates: false });
  assert.equal(files.length, 2);
  assert.equal(files.find(file => !file.folder).title, 'Intro to AI');
  const nested = files.find(file => file.folder);
  assert.equal(nested.folder, 'Week 02');
  assert.equal(nested.url, 'presentations/Week%2002/%D8%AF%D8%B1%D8%B3%20%231%20%26%20review.PDF');
  assert.match(nested.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('adding, replacing, and deleting files automatically updates discovery', async t => {
  const root = await fixture(t);
  const filename = path.join(root, 'presentations', 'Lecture.pdf');
  assert.equal((await scanPresentations({ root, pdfDirectory: 'presentations', gitDates: false })).length, 0);
  await writeFile(filename, '%PDF-1.7\nfirst version');
  const [before] = await scanPresentations({ root, pdfDirectory: 'presentations', gitDates: false });
  await writeFile(filename, '%PDF-1.7\nreplacement version');
  const [after] = await scanPresentations({ root, pdfDirectory: 'presentations', gitDates: false });
  assert.equal(before.id, after.id);
  assert.notEqual(before.revision, after.revision);
  await rm(filename);
  assert.equal((await scanPresentations({ root, pdfDirectory: 'presentations', gitDates: false })).length, 0);
});

test('rejects source directories outside the project or inside site internals', () => {
  for (const invalid of ['', '.', '../private', 'assets', 'dist/pdfs', '.git', '/private']) {
    assert.throws(() => resolvePdfDirectory(projectRoot, invalid));
  }
  assert.equal(resolvePdfDirectory(projectRoot, 'course-material/slides'), path.join(projectRoot, 'course-material', 'slides'));
});

test('build publishes only site assets and PDFs and removes files deleted from the library', async t => {
  const root = await fixture(t);
  await cp(path.join(projectRoot, 'index.html'), path.join(root, 'index.html'));
  await cp(path.join(projectRoot, 'assets'), path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'site.config.json'), JSON.stringify({ title: 'Tests', description: 'Test library', pdfDirectory: 'presentations' }));
  await writeFile(path.join(root, 'private.txt'), 'must not publish');
  const filename = path.join(root, 'presentations', 'Week 02', 'Lecture #2.pdf');
  await writeFile(filename, '%PDF-1.7\nfixture');
  const first = await build({ root });
  assert.equal(first.manifest.presentations.length, 1);
  assert.equal(first.manifest.presentations[0].sourceRelative, undefined);
  assert.equal(await readFile(path.join(root, 'dist', 'presentations', 'Week 02', 'Lecture #2.pdf'), 'utf8'), '%PDF-1.7\nfixture');
  await assert.rejects(readFile(path.join(root, 'dist', 'private.txt')));
  await rm(filename);
  const second = await build({ root });
  assert.equal(second.manifest.presentations.length, 0);
  await assert.rejects(readFile(path.join(root, 'dist', 'presentations', 'Week 02', 'Lecture #2.pdf')));
});
