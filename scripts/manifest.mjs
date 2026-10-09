import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function resolvePdfDirectory(root, directory) {
  if (typeof directory !== 'string' || !directory.trim() || path.isAbsolute(directory)) {
    throw new Error('pdfDirectory must be a nonempty directory relative to the repository.');
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, directory);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.') || ['node_modules', 'dist', 'assets', 'scripts', 'tests'].includes(part))) {
    throw new Error('pdfDirectory must stay inside the repository and outside site, build, and hidden directories.');
  }
  return resolved;
}

export function titleFromFilename(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || filename;
}

export function encodeFilePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function lastCommitDate(root, relativePath, fallback, gitDates) {
  if (gitDates) {
    try {
      const date = execFileSync('git', ['log', '-1', '--format=%cI', '--', relativePath], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (date && !Number.isNaN(Date.parse(date))) return new Date(date).toISOString();
    } catch { /* Local previews can run outside a Git repository. */ }
  }
  return fallback.toISOString();
}

async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function scanPresentations({ root, pdfDirectory, gitDates = true }) {
  const source = resolvePdfDirectory(root, pdfDirectory);
  const results = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        const relative = path.relative(source, absolute).split(path.sep).join('/');
        const sourceRelative = path.relative(root, absolute).split(path.sep).join('/');
        const info = await stat(absolute);
        const publicPath = `presentations/${relative}`;
        results.push({
          id: createHash('sha256').update(publicPath).digest('hex').slice(0, 20),
          revision: await hashFile(absolute),
          title: titleFromFilename(entry.name),
          filename: entry.name,
          folder: path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative),
          path: publicPath,
          url: encodeFilePath(publicPath),
          bytes: info.size,
          updatedAt: lastCommitDate(root, sourceRelative, info.mtime, gitDates),
          sourceRelative
        });
      }
    }
  }
  try { await walk(source); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`The PDF directory "${pdfDirectory}" does not exist. Create it or change site.config.json.`);
    throw error;
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path));
}
