/**
 * PDF → plain text for the composer.
 *
 * pi only accepts image content parts, so a PDF is converted to text and sent
 * as a `<file>` block — the same shape micro-harness uses for non-image files.
 * Extraction is capped so a 500-page scan cannot blow up the context window.
 */
import * as pdfjs from 'pdfjs-dist'

// Served as a plain `.js` from public/: the packaged app's static server knows
// `text/javascript` for `.js` (not `.mjs`), and CSP allows same-origin workers.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.js'

const MAX_PAGES = 50
const MAX_CHARS = 200_000

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({
    data,
    // CJK text needs the packaged CMaps; standard fonts cover PDFs that embed none.
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  const doc = await task.promise
  try {
    const out: string[] = []
    let chars = 0
    const pages = Math.min(doc.numPages, MAX_PAGES)
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? String(item.str) : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      out.push(`[page ${p}] ${text}`)
      chars += text.length
      if (chars >= MAX_CHARS) break
    }
    return out.join('\n\n').slice(0, MAX_CHARS)
  } finally {
    await task.destroy()
  }
}
