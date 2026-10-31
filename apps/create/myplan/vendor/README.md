# Local print dependencies

These files ship with My Plan so PDF generation does not depend on a third-party CDN.

- `jspdf.umd.min.js`: jsPDF **4.2.1**, MIT. Downloaded from https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js. SHA-256 `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54`. License in `jsPDF-LICENSE.txt`.
- `NotoSans-Regular.ttf`: Noto Sans Regular, SIL Open Font License 1.1. Downloaded from https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf and pinned here by SHA-256 `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`. License in `NotoSans-LICENSE.txt`.

The print module embeds Noto Sans and all images in generated PDFs. It checks for missing text glyphs and reports them instead of silently substituting missing characters. The supplied font supports Latin, Greek and Cyrillic text; other scripts or emoji may need another locally licensed font in a future change.

All illustrations in `../src/illustrations.js` are original SVG pictograms generated for this app. They contain no remote links or platform emoji. SVGs are used in the page preview; the PDF embeds high-resolution JPEG renderings on white, keeping text as vector text.
