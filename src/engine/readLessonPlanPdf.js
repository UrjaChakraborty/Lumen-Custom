import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PDF_PAGES = 200;
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

function pdfPageLines(items, pageHeight) {
  const positioned = items
    .filter((item) => typeof item?.str === "string" && item.str.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      font: String(item.fontName || ""),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];

  for (const item of positioned) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  const fontSizes = positioned
    .map((item) => item.height)
    .filter((height) => height >= 8.5 && height <= 14);
  const bodySize = fontSizes.length
    ? fontSizes.sort((a, b) => a - b)[Math.floor(fontSizes.length / 2)]
    : 9;

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      if (line.y > pageHeight * 0.92 || line.y < pageHeight * 0.06) return null;
      const sorted = line.items.sort((a, b) => a.x - b.x);
      let text = "";
      let right = null;
      for (const item of sorted) {
        if (text && right !== null) {
          const gap = item.x - right;
          if (gap > Math.max(2, item.height * 0.2)) {
            text += gap > 32 ? " | " : " ";
          }
        }
        text += item.text;
        right = item.x + item.width;
      }
      text = text.replace(/[ \t]+/g, " ").trim();
      if (!text) return null;

      const size = Math.max(...line.items.map((item) => item.height));
      const bold = line.items.some((item) => /bold|heavy/i.test(item.font));
      const titleLike =
        size >= Math.max(bodySize * 1.2, bodySize + 1.5) ||
        (bold && size >= bodySize * 0.94 && text.length <= 60);
      return titleLike && text.length <= 100 ? `## ${text}` : text;
    })
    .filter(Boolean);
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
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    stopAtErrors: false,
    useSystemFonts: true,
  });
  let document;
  let ocrWorker = null;
  let ocrUnavailable = false;
  const warnings = [];
  try {
    document = await loadingTask.promise;
    const pagesToRead = Math.min(document.numPages, MAX_PDF_PAGES);
    if (document.numPages > pagesToRead) {
      warnings.push(`Only the first ${pagesToRead} of ${document.numPages} pages were read.`);
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      onProgress(`Reading PDF page ${pageNumber} of ${pagesToRead}…`);
      let page;
      try {
        page = await document.getPage(pageNumber);
      } catch {
        warnings.push(`Page ${pageNumber} could not be opened and was skipped.`);
        continue;
      }

      let extracted = "";
      try {
        const pageHeight =
          Math.abs(page.view?.[3] - page.view?.[1]) ||
          page.getViewport({ scale: 1 }).height;
        extracted = pdfPageLines(
          (await page.getTextContent()).items,
          pageHeight
        ).join("\n");
      } catch {
        warnings.push(`Text extraction failed on page ${pageNumber}; OCR was attempted.`);
      }

      let text = extracted;
      if (extracted.replace(/\s/g, "").length < OCR_TEXT_THRESHOLD && !ocrUnavailable) {
        try {
          if (!ocrWorker) {
            onProgress("Preparing OCR. The PDF stays in your browser.");
            ocrWorker = await createOcrWorker(onProgress);
          }
          onProgress(`Reading scanned page ${pageNumber} of ${pagesToRead}…`);
          const ocrText = await recognizePage(page, ocrWorker);
          if (ocrText) text = ocrText;
          else if (!extracted) warnings.push(`No text was recovered from page ${pageNumber}.`);
        } catch {
          ocrUnavailable = !ocrWorker;
          warnings.push(
            extracted
              ? `OCR was unavailable on page ${pageNumber}; extracted PDF text was kept.`
              : `Page ${pageNumber} could not be read with text extraction or OCR.`
          );
        } finally {
          page.cleanup();
        }
      } else {
        page.cleanup();
      }

      if (text.trim()) pages.push(`## Page ${pageNumber}\n${text.trim()}`);
    }

    const text = pages.join("\n\n");
    if (!text.trim()) {
      throw new PdfReadError(
        warnings.length
          ? `No readable text could be recovered. ${warnings[0]}`
          : "No readable text was found. If this is a scanned PDF, check that OCR data can download and try again."
      );
    }
    return { text, warnings };
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new PdfReadError("This PDF is password-protected. Remove its password and try again.");
    }
    if (error instanceof PdfReadError) throw error;
    if (error?.name === "InvalidPDFException" || error?.name === "MissingPDFException") {
      throw new PdfReadError(
        "The PDF could not be opened. Try exporting or printing it as a new PDF, then upload that copy."
      );
    }
    throw new PdfReadError(
      "Text extraction failed for this PDF. Try exporting or printing it as a new PDF, then upload that copy."
    );
  } finally {
    try {
      if (ocrWorker) await ocrWorker.terminate();
    } finally {
      await loadingTask.destroy();
    }
  }
}
