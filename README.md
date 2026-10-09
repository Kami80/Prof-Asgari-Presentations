# Presentation shelf

A static PDF presentation library with preview cards, a slide reader, pen marks, highlights, and notes. It runs on GitHub Pages. **Add PDFs to `presentations/` and commit them: the library updates automatically, without editing code or maintaining a file list.**

## Publish on GitHub Pages

1. Create a GitHub repository and push this project's source files, including `package-lock.json` and `.github/workflows/pages.yml`. Keep the project at the repository root. Do not upload `node_modules/`, `dist/`, `.npm-cache/`, or `.qa/`.
2. Open the repository's **Settings → Pages**. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions → Publish presentation library → Run workflow** for the initial deployment, or push a new commit to the repository's default branch.
4. Once the workflow completes, the published address appears in **Settings → Pages** and in the deployment job.

This follows [GitHub's custom Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). The workflow builds the static site and publishes only the `dist/` output. It supports a repository URL such as `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`, a user site, or a custom domain.

The workflow runs on pushes to the default branch; other branches are skipped. The built website needs no server, tokens, runtime GitHub API requests, or external CDN.

## Add presentations

Put PDFs in this folder, including any subfolders you want:

```text
presentations/
  Introduction.pdf
  Week 01/
    Lecture_01.pdf
  Week 02/
    Linear algebra #1.PDF
    نظریه یادگیری.pdf
```

Commit and push them to the default branch, or use GitHub's **Add file → Upload files** inside the `presentations/` directory. Wait for the deployment workflow to finish, then refresh the site. Your new PDFs appear with first-slide previews. Removing or renaming a PDF updates the library on the next deployment too.

You can upload PDF files without installing Node.js on your own computer. GitHub runs the build for you.

- Discovery is recursive and accepts `.pdf` and `.PDF`.
- Hidden files, hidden folders, symlinks, and non-PDF files are excluded.
- Titles come from filenames; underscores become spaces.
- Top-level folders become filters. Search includes filenames and nested folder paths.
- Dates use the most recent Git commit affecting each PDF; local uncommitted files use their modification date.
- Password-protected or damaged files keep a library card and an original-PDF link when the reader cannot open them.

Browsers cannot list a GitHub Pages directory. The build scans your PDF folder, generates `presentations.json`, and copies the PDFs into the static site. That automatic build is what makes new presentations appear without code changes.

## Reader and annotations

Open a presentation card to read its PDF. Use previous/next buttons, a slide number, zoom, fit-to-screen, or full screen. You can select PDF text in Read mode.

- **Pen:** draw with your mouse, touch screen, or stylus.
- **Highlighter:** drag a rectangle over a region of the slide.
- **Eraser:** tap a pen mark or highlighted region to remove it.
- **Undo / redo:** apply to marks on the current slide.
- **Slide notes:** write separate notes for each slide.
- **Save marked PDF:** download a copy with your pen and highlights flattened onto the PDF. Written notes are separate.
- **Download notes:** download all written slide notes as a UTF-8 text file.
- **Download original:** get the unchanged source PDF.

Annotations save automatically in **the current browser on the current device**. Visitors have their own private annotations; they are not shared or written back to GitHub. Clearing browser data removes saved work, so use the download buttons to keep a copy. Storage failures are shown in the reader. Moving a PDF or replacing its contents starts a new annotation set, preventing marks from being applied to the wrong slides.

| Shortcut | Action |
| --- | --- |
| `/` | Focus library search |
| `←` / `→`, Page Up / Page Down | Previous / next slide |
| `V`, `P`, `H`, `E` | Read, pen, highlighter, eraser |
| Ctrl/Cmd + Z | Undo mark |
| Ctrl/Cmd + Shift + Z | Redo mark |
| Escape | Return to library when not in full screen |

## Customize once

Edit `site.config.json` to change the site name, introductory text, or the source PDF directory:

```json
{
  "title": "Presentations",
  "description": "A place to read, annotate, and revisit your presentations.",
  "pdfDirectory": "presentations"
}
```

`pdfDirectory` must be an existing directory inside the repository. PDFs are published under `presentations/` regardless of the source folder's name. You never need to update this configuration when adding a PDF.

## Preview locally

Install Node.js 24, then run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. After adding PDFs locally, run `npm run build` and refresh. `npm start` serves an existing build. Opening `index.html` directly with a `file://` URL does not support the module imports and PDF loading.

## Verification

```sh
npm test
npm run test:browser
```

The first command checks recursive discovery, special filenames, replacement/deletion behavior, build output, and annotation validation. The browser checks use isolated generated PDFs, including a rotated/cropped slide, and verify reading, drawing, saving, exports, mobile layouts, and repository subpath hosting. Their screenshots and output go into the ignored `.qa/` directory. On Windows the browser checks use installed Microsoft Edge; elsewhere install Chromium with `npx playwright install chromium`, or set `BROWSER_CHANNEL` to an installed Playwright browser channel.

If a local browser integration intercepts test PDF requests and replaces them with HTTP 204, run the browser checks with `PDF_TEST_NODE_FETCH=1`. This test-only mode forwards actual responses from the local HTTP server through Node; the published site has no such route or server dependency. For an affected visitor, the reader explains how to disable automatic PDF capture for the site. Download managers can interfere with embedded PDF readers, as described in [IDM's documentation](https://forum.internetdownloadmanager.com/register/new_faq/sites2_2.html).

The reader uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) and exports marks using [pdf-lib](https://pdf-lib.js.org/). Their libraries, font data, character maps, WebAssembly resources, and licenses are copied into the site during the build.
