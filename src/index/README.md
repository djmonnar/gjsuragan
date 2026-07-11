# Employee index HTML source

`index.html` is the generated file served by GitHub Pages. Edit the employee
screen markup in `src/index/parts`, then rebuild the deployable file from the
repository root:

```text
node scripts/build-index-html.js
```

Verify that the generated file is current without changing it:

```text
node scripts/build-index-html.js --check
```

The order in `manifest.json` is the actual DOM order. The build joins part
bytes exactly as stored and does not insert separators or line breaks. Editing
only `index.html` makes the check fail.

GitHub Pages does not provide runtime HTML includes, so the browser does not
fetch or assemble partial files. Keeping one generated `index.html` also avoids
loading flashes and preserves the current static deployment behavior.

External JavaScript tags remain in `90-scripts-document-end.html`. Their order
must not change because later scripts use globals initialized by earlier ones.
Firebase initialization remains inline in `00-document-head.html` for the same
reason and is not moved by this source split.
