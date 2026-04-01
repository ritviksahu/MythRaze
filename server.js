const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { buildAnalysisRecord, ENGINE_VERSION } = require("./lib/analysis-engine");

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const ANALYSES_FILE = path.join(DATA_DIR, "analyses.json");
const DEMO_ANALYSES_FILE = path.join(DATA_DIR, "demo-investigations.json");
const INVESTIGATION_ASSETS_DIR = path.join(__dirname, "Images_videos");
const MAX_ANALYSES = 24;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ico": "image/x-icon"
};

const state = {
  analyses: [],
  demoAnalyses: [],
  byId: new Map(),
  demoById: new Map(),
  byFingerprint: new Map(),
  inflightByFingerprint: new Map(),
  persistChain: Promise.resolve(),
  persistQueueDepth: 0,
  totalHttpRequests: 0,
  totalAnalysisRequests: 0,
  cacheHits: 0,
  startedAt: Date.now(),
  currentPort: DEFAULT_PORT
};

function fingerprintKey(mediaType, hash) {
  return `${mediaType}:${hash}`;
}

function buildHeaders(overrides = {}) {
  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,HEAD",
    "Access-Control-Max-Age": "86400",
    ...overrides
  };

  if (ALLOWED_ORIGIN !== "*") {
    headers.Vary = "Origin";
  }

  return headers;
}

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  try {
    await fsp.access(ANALYSES_FILE);
  } catch (error) {
    await fsp.writeFile(ANALYSES_FILE, "[]\n", "utf8");
  }
}

async function ensureDemoDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  try {
    await fsp.access(DEMO_ANALYSES_FILE);
  } catch (error) {
    await fsp.writeFile(DEMO_ANALYSES_FILE, "[]\n", "utf8");
  }
}

function normalizeAnalysis(analysis) {
  if (!analysis || !analysis.id || !analysis.file || !analysis.file.hash) {
    return null;
  }

  return {
    ...analysis,
    requestCount: analysis.requestCount || 1,
    lastAccessedAt: analysis.lastAccessedAt || analysis.createdAt
  };
}

function isCurrentEngineAnalysis(analysis) {
  return analysis?.engine?.version === ENGINE_VERSION;
}

function sortAnalysesByCreatedAtDesc(analyses) {
  return analyses.sort(
    (left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
  );
}

function rebuildIndexes() {
  state.byId.clear();
  state.byFingerprint.clear();

  for (const analysis of state.analyses) {
    state.byId.set(analysis.id, analysis);
    state.byFingerprint.set(
      fingerprintKey(analysis.mediaType, analysis.file.hash),
      analysis
    );
  }
}

function rebuildDemoIndexes() {
  state.demoById.clear();

  for (const analysis of state.demoAnalyses) {
    state.demoById.set(analysis.id, analysis);
  }
}

async function loadAnalysesIntoState() {
  await ensureDataFile();
  let shouldPersistFilteredAnalyses = false;

  try {
    const raw = await fsp.readFile(ANALYSES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = (Array.isArray(parsed) ? parsed : [])
      .map(normalizeAnalysis)
      .filter(Boolean);
    state.analyses = sortAnalysesByCreatedAtDesc(
      normalized.filter(isCurrentEngineAnalysis)
    ).slice(0, MAX_ANALYSES);
    shouldPersistFilteredAnalyses = state.analyses.length !== normalized.length;
  } catch (error) {
    state.analyses = [];
  }

  rebuildIndexes();

  if (shouldPersistFilteredAnalyses) {
    await queuePersist();
  }
}

async function loadDemoAnalysesIntoState() {
  await ensureDemoDataFile();

  try {
    const raw = await fsp.readFile(DEMO_ANALYSES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    state.demoAnalyses = sortAnalysesByCreatedAtDesc(
      (Array.isArray(parsed) ? parsed : [])
        .map(normalizeAnalysis)
        .filter(Boolean)
        .filter(isCurrentEngineAnalysis)
    ).slice(0, MAX_ANALYSES);
  } catch (error) {
    state.demoAnalyses = [];
  }

  rebuildDemoIndexes();
}

function queuePersist() {
  const snapshot = `${JSON.stringify(state.analyses, null, 2)}\n`;
  state.persistQueueDepth += 1;
  state.persistChain = state.persistChain
    .then(() => fsp.writeFile(ANALYSES_FILE, snapshot, "utf8"))
    .catch((error) => {
      console.error("Failed to persist analyses:", error);
    })
    .finally(() => {
      state.persistQueueDepth = Math.max(0, state.persistQueueDepth - 1);
    });

  return state.persistChain;
}

function cloneAnalysisForResponse(analysis, api = {}) {
  const clone =
    typeof structuredClone === "function"
      ? structuredClone(analysis)
      : JSON.parse(JSON.stringify(analysis));

  clone.api = {
    sharedApi: true,
    cacheHit: false,
    responseMode: "fresh",
    allowOrigin: ALLOWED_ORIGIN,
    requestCount: analysis.requestCount || 1,
    servedAt: new Date().toISOString(),
    ...api
  };

  return clone;
}

function trimAnalyses() {
  if (state.analyses.length <= MAX_ANALYSES) {
    return;
  }

  state.analyses = state.analyses.slice(0, MAX_ANALYSES);
  rebuildIndexes();
}

function registerAccess(analysis) {
  analysis.requestCount = (analysis.requestCount || 0) + 1;
  analysis.lastAccessedAt = new Date().toISOString();
  queuePersist();
}

async function createFreshAnalysis(payload) {
  const analysis = normalizeAnalysis(buildAnalysisRecord(payload));

  if (!analysis) {
    throw new Error("Unable to build analysis.");
  }

  analysis.requestCount = 1;
  analysis.lastAccessedAt = analysis.createdAt;
  state.analyses.unshift(analysis);
  trimAnalyses();
  rebuildIndexes();
  await queuePersist();
  return analysis;
}

async function getOrCreateAnalysis(payload) {
  const key = fingerprintKey(payload.mediaType, payload.fileHash);
  state.totalAnalysisRequests += 1;

  const cached = state.byFingerprint.get(key);
  if (cached) {
    state.cacheHits += 1;
    registerAccess(cached);
    return cloneAnalysisForResponse(cached, {
      cacheHit: true,
      responseMode: "cache",
      sharedFingerprint: key
    });
  }

  const inflight = state.inflightByFingerprint.get(key);
  if (inflight) {
    state.cacheHits += 1;
    const analysis = await inflight;
    registerAccess(analysis);
    return cloneAnalysisForResponse(analysis, {
      cacheHit: true,
      responseMode: "shared-inflight",
      sharedFingerprint: key
    });
  }

  const buildPromise = createFreshAnalysis(payload);
  state.inflightByFingerprint.set(key, buildPromise);

  try {
    const analysis = await buildPromise;
    return cloneAnalysisForResponse(analysis, {
      cacheHit: false,
      responseMode: "fresh",
      sharedFingerprint: key
    });
  } finally {
    state.inflightByFingerprint.delete(key);
  }
}

function summarizeAnalyses(analyses) {
  return analyses.map((analysis) => ({
    id: analysis.id,
    createdAt: analysis.createdAt,
    mediaType: analysis.mediaType,
    confidence: analysis.confidence,
    verdict: analysis.verdict,
    summary: analysis.summary,
    file: analysis.file,
    groundTruth: analysis.groundTruth || null,
    requestCount: analysis.requestCount || 1,
    lastAccessedAt: analysis.lastAccessedAt || analysis.createdAt
  }));
}

function getAnalysisById(id) {
  return state.byId.get(id) || state.demoById.get(id) || null;
}

function getLatestCaseAt() {
  return [state.analyses[0]?.createdAt, state.demoAnalyses[0]?.createdAt]
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function validatePayload(payload) {
  if (
    !payload ||
    !payload.fileName ||
    !payload.fileType ||
    typeof payload.fileSize !== "number" ||
    !payload.fileHash ||
    !payload.mediaType ||
    !payload.metrics
  ) {
    return "Missing required analysis fields.";
  }

  if (!["image", "video"].includes(payload.mediaType)) {
    return "Unsupported media type.";
  }

  return null;
}

function sendJson(res, statusCode, payload, headOnly = false) {
  const body = JSON.stringify(payload);
  res.writeHead(
    statusCode,
    buildHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    })
  );
  res.end(headOnly ? undefined : body);
}

function sendText(res, statusCode, message, headOnly = false) {
  res.writeHead(
    statusCode,
    buildHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    })
  );
  res.end(headOnly ? undefined : message);
}

async function sendFile(filePath, res, headOnly = false) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const data = await fsp.readFile(filePath);
    const type = detectContentType(ext, data);

    res.writeHead(
      200,
      buildHeaders({
        "Content-Type": type,
        "Cache-Control": "public, max-age=60"
      })
    );
    res.end(headOnly ? undefined : data);
  } catch (error) {
    sendText(res, 404, "Not found", headOnly);
  }
}

function detectContentType(ext, data) {
  const fallbackType = MIME_TYPES[ext] || "application/octet-stream";
  if ((ext === ".jpg" || ext === ".jpeg") && looksLikeAvif(data)) {
    return "image/avif";
  }
  return fallbackType;
}

function looksLikeAvif(data) {
  if (!Buffer.isBuffer(data) || data.length < 16) {
    return false;
  }

  if (data.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }

  const brands = data.toString("ascii", 8, Math.min(32, data.length));
  return brands.includes("avif") || brands.includes("avis");
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", () => {
      reject(new Error("Unable to read request body"));
    });
  });
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const headOnly = method === "HEAD";
  const isReadMethod = method === "GET" || method === "HEAD";

  if (method === "OPTIONS") {
    res.writeHead(204, buildHeaders({ "Cache-Control": "no-store" }));
    res.end();
    return true;
  }

  if (isReadMethod && url.pathname === "/api/health") {
    const cacheHitRate = state.totalAnalysisRequests
      ? Math.round((state.cacheHits / state.totalAnalysisRequests) * 100)
      : 0;

    sendJson(
      res,
      200,
      {
        ok: true,
        service: "Mythraze",
        api: "online",
        apiMode: "shared-multi-client",
        engine: `Mythraze Forensic Ensemble ${ENGINE_VERSION}`,
        storedCases: state.analyses.length + state.demoAnalyses.length,
        userCases: state.analyses.length,
        demoCases: state.demoAnalyses.length,
        lastCaseAt: getLatestCaseAt(),
        signalFamilies: 4,
        supportedMedia: ["image", "video"],
        multiClientReady: true,
        cacheEntries: state.byFingerprint.size,
        inFlightAnalyses: state.inflightByFingerprint.size,
        cacheHits: state.cacheHits,
        cacheHitRate,
        writeQueueDepth: state.persistQueueDepth,
        totalHttpRequests: state.totalHttpRequests,
        uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
        networkMode: HOST === "0.0.0.0" ? "lan" : "local",
        allowOrigin: ALLOWED_ORIGIN
      },
      headOnly
    );
    return true;
  }

  if (isReadMethod && url.pathname === "/api/analyses") {
    sendJson(
      res,
      200,
      {
        items: summarizeAnalyses(state.analyses),
        demoItems: summarizeAnalyses(state.demoAnalyses)
      },
      headOnly
    );
    return true;
  }

  if (method === "POST" && url.pathname === "/api/analyze") {
    try {
      const payload = await parseJsonBody(req);
      const validationError = validatePayload(payload);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return true;
      }

      const analysis = await getOrCreateAnalysis(payload);
      sendJson(res, 200, analysis);
      return true;
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return true;
    }
  }

  const analysisIdMatch = url.pathname.match(/^\/api\/analyses\/([^/]+)$/);
  if (isReadMethod && analysisIdMatch) {
    const analysis = getAnalysisById(analysisIdMatch[1]);
    if (!analysis) {
      sendJson(res, 404, { error: "Analysis not found" }, headOnly);
      return true;
    }

    sendJson(
      res,
      200,
      cloneAnalysisForResponse(analysis, {
        cacheHit: false,
        responseMode: "history"
      }),
      headOnly
    );
    return true;
  }

  const reportMatch = url.pathname.match(/^\/api\/analyses\/([^/]+)\/report$/);
  if (isReadMethod && reportMatch) {
    const analysis = getAnalysisById(reportMatch[1]);
    if (!analysis) {
      sendJson(res, 404, { error: "Analysis not found" }, headOnly);
      return true;
    }

    res.writeHead(
      200,
      buildHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${analysis.id}.json"`,
        "Cache-Control": "no-store"
      })
    );
    res.end(headOnly ? undefined : `${JSON.stringify(analysis, null, 2)}\n`);
    return true;
  }

  return false;
}

async function handleRequest(req, res) {
  state.totalHttpRequests += 1;
  const url = new URL(
    req.url,
    `http://${req.headers.host || `${HOST}:${state.currentPort || DEFAULT_PORT}`}`
  );

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (!handled) {
      sendJson(res, 404, { error: "API route not found" }, req.method === "HEAD");
    }
    return;
  }

  if (url.pathname.startsWith("/investigation-assets/")) {
    const assetName = path.basename(url.pathname);
    const filePath = path.join(INVESTIGATION_ASSETS_DIR, assetName);

    if (!filePath.startsWith(INVESTIGATION_ASSETS_DIR)) {
      sendText(res, 403, "Forbidden", req.method === "HEAD");
      return;
    }

    await sendFile(filePath, res, req.method === "HEAD");
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden", req.method === "HEAD");
    return;
  }

  await sendFile(filePath, res, req.method === "HEAD");
}

async function startServer() {
  await loadAnalysesIntoState();
  await loadDemoAnalysesIntoState();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Unhandled request error:", error);
      sendJson(res, 500, { error: "Internal server error" }, req.method === "HEAD");
    });
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;

  const activePort = await listenWithFallback(server, DEFAULT_PORT);
  state.currentPort = activePort;
  console.log(`Mythraze running at http://${HOST}:${activePort}`);
}

startServer().catch((error) => {
  console.error("Failed to start Mythraze:", error);
  process.exit(1);
});

function listenWithFallback(server, port, attemptsLeft = 15) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);

      if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is busy, trying ${nextPort}...`);
        resolve(listenWithFallback(server, nextPort, attemptsLeft - 1));
        return;
      }

      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve(port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}
