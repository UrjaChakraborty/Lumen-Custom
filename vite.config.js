import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const OCR_ASSETS = [
  'worker.min.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
]

function tesseractAssets() {
  const files = new Map(
    OCR_ASSETS.map((name) => [
      name,
      path.join(
        projectRoot,
        'node_modules',
        name === 'worker.min.js' ? 'tesseract.js/dist' : 'tesseract.js-core',
        name
      ),
    ])
  )

  return {
    name: 'tesseract-assets',
    configureServer(server) {
      server.middlewares.use('/ocr', async (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\/+/, '')
        const file = files.get(name)
        if (!file) return next()
        try {
          const contents = await readFile(file)
          res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.end(contents)
        } catch (error) {
          next(error)
        }
      })
    },
    async buildStart() {
      for (const [name, file] of files) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: await readFile(file) })
      }
    },
  }
}

// Dev-only plugin: serve the /api/* serverless functions under `npm run dev`.
// Vite normally ignores the /api directory (those run only on Vercel), so
// without this the frontend's fetch("/api/generate") 404s in local dev and the
// UI falls back to the mock. This wires the real handler into Vite's dev server
// so `npm run dev` behaves like production and hits the live Gemini API.
//
// The API key stays server-side: it's read from process.env inside the handler
// and is never added to `define`/import.meta.env, so it never reaches the
// browser bundle.
function apiDevServer(env) {
  return {
    name: 'api-dev-server',
    apply: 'serve', // dev only — no effect on `vite build`
    configureServer(server) {
      // Make the .env.local key visible to the handler via process.env.
      if (env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        try {
          // Buffer the request body, refusing anything oversized WHILE reading
          // rather than after. Uploaded revisions may reach 512KB; parseBody
          // still rejects non-upload requests above 64KB.
          const MAX = 512 * 1024
          const chunks = []
          let size = 0
          let tooLarge = false
          for await (const c of req) {
            size += c.length
            if (size > MAX) { tooLarge = true; break }
            chunks.push(c)
          }
          if (tooLarge) {
            // Answer, then close the connection cleanly.
            //
            // The first version called req.destroy() here, which tears down the
            // socket while the client is still writing. The client survives that
            // request but the NEXT one on the same keep-alive connection fails
            // with no response at all — the security suite caught it as a
            // request immediately after the 1MB case returning nothing.
            //
            // Connection: close tells the client not to reuse this socket, and
            // resume() drains what is still in flight so the response is not cut
            // off mid-write.
            res.statusCode = 413
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Connection', 'close')
            res.end(JSON.stringify({ error: 'Request body too large.' }))
            req.resume()
            return
          }
          // Pass the RAW string through rather than parsing here. Parsing in the
          // shim meant malformed JSON threw and surfaced as a 500 carrying the
          // parser's message, while production hands the body to parseBody()
          // which answers 400. Dev has to fail the way production fails or the
          // guard cannot be tested.
          const raw = Buffer.concat(chunks).toString()

          // Adapt Node's res to the Vercel-style { status, json, setHeader } API.
          const shim = {
            statusCode: 200,
            status(code) { res.statusCode = code; return this },
            setHeader(k, v) { res.setHeader(k, v); return this },
            json(payload) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(payload))
              return this
            },
          }

          // Route to the matching serverless function by path (mirrors Vercel),
          // e.g. /api/revise → /api/revise.js. Loaded through Vite so its
          // imports resolve.
          //
          // Every route needs an entry here. /api/section previously fell
          // through to the generate.js default, so section-level regenerate
          // silently ran a whole-document generation in dev and api/section.js
          // was never exercised at all.
          const path = req.url.split('?')[0]
          const ROUTES = {
            '/api/generate': '/api/generate.js',
            '/api/revise': '/api/revise.js',
            '/api/section': '/api/section.js',
            '/api/feedback': '/api/feedback.js',
          }
          const file = ROUTES[path]
          if (!file) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Not found' }))
            return
          }
          const mod = await server.ssrLoadModule(file)
          // Pass headers + socket through so the security guards (origin check,
          // per-IP rate limit) behave the same in dev as on Vercel.
          await mod.default(
            { method: req.method, headers: req.headers, socket: req.socket, body: raw },
            shim
          )
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Dev API error: ' + (err?.message || 'unknown') }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix loads ALL env vars (incl. unprefixed GEMINI_API_KEY) from
  // .env.local — used only here on the Node side, never exposed to the client.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tesseractAssets(), apiDevServer(env)],
    server: {
      port: 5173,
      open: false,
    },
  }
})
