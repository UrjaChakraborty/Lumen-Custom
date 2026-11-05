import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PDF_PAGES = 40;
const OCR_TEXT_THRESHOLD = 120;
const OCR_MAX_DIMENSION = 1800;
const OCR_LANG_PATH =
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int";

export class PdfReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "PdfReadError";
  }
}

function pageText(items) {
  return items
    .map((item) => (typeof item?.str === "string" ? item.str : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function createOcrWorker(onProgress) {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng", 1, {
    workerPath: new URL(`${import.meta.env.BASE_URL}ocr/worker.min.js`, window.location.href).href,
    workerBlobURL: false,
    corePath: new URL(
      `${import.meta.env.BASE_URL}ocr/tesseract-core-lstm.wasm.js`,
      window.location.href
    ).href,
    langPath: OCR_LANG_PATH,
    logger: (message) => {
      if (message.status === "loading language traineddata") {
        onProgress("Downloading English OCR data (cached for next time)…");
      } else if (message.status === "initializing tesseract") {
        onProgress("Starting OCR…");
      }
    },
  });
}

async function recognizePage(page, worker) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    2,
    OCR_MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height)
  );
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new PdfReadError("Could not prepare this PDF page for OCR.");

  try {
    await page.render({ canvasContext: context, viewport }).promise;
    const result = await worker.recognize(canvas);
    return String(result.data.text || "").trim();
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

export async function readLessonPlanPdf(file, onProgress = () => {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new PdfReadError("That file does not appear to be a valid PDF.");
  }

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    stopAtErrors: true,
  });
  let document;
  let ocrWorker = null;
  try {
    document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfReadError(`This PDF has ${document.numPages} pages. Upload a PDF with ${MAX_PDF_PAGES} pages or fewer.`);
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(`Reading PDF page ${pageNumber} of ${document.numPages}…`);
      const page = await document.getPage(pageNumber);
      const extracted = pageText((await page.getTextContent()).items);
      let text = extracted;

      if (extracted.replace(/\s/g, "").length < OCR_TEXT_THRESHOLD) {
        if (!ocrWorker) {
          onProgress("Preparing OCR. The PDF stays in your browser.");
          ocrWorker = await createOcrWorker(onProgress);
        }
        onProgress(`Reading scanned page ${pageNumber} of ${document.numPages}…`);
        text = await recognizePage(page, ocrWorker);
      } else {
        page.cleanup();
      }

      if (text) pages.push(`## Page ${pageNumber}\n${text}`);
    }

    const text = pages.join("\n\n");
    if (!text.trim()) {
      throw new PdfReadError("No readable text was found in the PDF.");
    }
    return text;
  } finally {
    try {
      if (ocrWorker) await ocrWorker.terminate();
    } finally {
      await loadingTask.destroy();
    }
  }
}
