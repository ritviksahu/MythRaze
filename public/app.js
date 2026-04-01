const fileInput = document.getElementById("fileInput");
const analyzeButton = document.getElementById("analyzeButton");
const dropzone = document.getElementById("dropzone");
const previewContainer = document.getElementById("previewContainer");
const verdictTitle = document.getElementById("verdictTitle");
const scorePill = document.getElementById("scorePill");
const summaryText = document.getElementById("summaryText");
const meterFill = document.getElementById("meterFill");
const signalsGrid = document.getElementById("signalsGrid");
const insightsList = document.getElementById("insightsList");
const pipelineList = document.getElementById("pipelineList");
const recommendationsList = document.getElementById("recommendationsList");
const historyList = document.getElementById("historyList");
const userHistoryList = document.getElementById("userHistoryList");
const downloadReportButton = document.getElementById("downloadReportButton");
const refreshHistoryButton = document.getElementById("refreshHistoryButton");
const viewPreviewButton = document.getElementById("viewPreviewButton");
const caseIdValue = document.getElementById("caseIdValue");
const fileMetaValue = document.getElementById("fileMetaValue");
const hashValue = document.getElementById("hashValue");
const engineValue = document.getElementById("engineValue");
const backendStatusText = document.getElementById("backendStatusText");
const backendSummaryText = document.getElementById("backendSummaryText");
const storedCasesValue = document.getElementById("storedCasesValue");
const engineModeValue = document.getElementById("engineModeValue");
const mediaModal = document.getElementById("mediaModal");
const mediaModalContent = document.getElementById("mediaModalContent");
const mediaModalTitle = document.getElementById("mediaModalTitle");
const mediaModalMeta = document.getElementById("mediaModalMeta");
const closeMediaModalButton = document.getElementById("closeMediaModalButton");

let selectedFile = null;
let selectedObjectUrl = null;
let currentAnalysisId = null;
let currentPreviewMedia = null;
let demoHistoryItems = [];
const sessionHistory = [];
const sessionHistoryById = new Map();

const defaultSignals = [
  {
    title: "Artifact Risk",
    score: "--",
    description: "Detects texture and edge irregularities."
  },
  {
    title: "Compression Risk",
    score: "--",
    description: "Measures blockiness and re-encoding cues."
  },
  {
    title: "Consistency Risk",
    score: "--",
    description: "Checks local visual coherence across regions."
  },
  {
    title: "Temporal Risk",
    score: "--",
    description: "Assesses frame stability for videos."
  }
];

bootstrap();

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    setSelectedFile(file);
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    setSelectedFile(file);
  }
});

analyzeButton.addEventListener("click", async () => {
  if (!selectedFile) {
    return;
  }

  setLoadingState(selectedFile);

  try {
    const startedAt = performance.now();
    const extraction = selectedFile.type.startsWith("video/")
      ? await extractVideoMetrics(selectedFile)
      : await extractImageMetrics(selectedFile);
    const fileHash = await computeFileHash(selectedFile);

    const analysis = await submitAnalysis({
      fileName: selectedFile.name,
      fileType: selectedFile.type,
      fileSize: selectedFile.size,
      fileHash,
      mediaType: extraction.mediaType,
      metrics: extraction.metrics,
      extraContext: extraction.extraContext,
      previewImage: extraction.previewImage,
      clientProcessingMs: performance.now() - startedAt
    });

    upsertSessionHistory(createSessionAnalysisEntry(analysis, selectedFile));
    renderResult(analysis);
    await Promise.all([loadHealth(), loadHistory()]);
  } catch (error) {
    renderFailure(error);
  }
});

downloadReportButton.addEventListener("click", () => {
  if (!currentAnalysisId) {
    return;
  }

  window.open(`/api/analyses/${encodeURIComponent(currentAnalysisId)}/report`, "_blank");
});

viewPreviewButton.addEventListener("click", () => {
  if (currentPreviewMedia) {
    openMediaModal(currentPreviewMedia);
  }
});

refreshHistoryButton.addEventListener("click", async () => {
  refreshHistoryButton.disabled = true;
  try {
    await Promise.all([loadHealth(), loadHistory()]);
  } finally {
    refreshHistoryButton.disabled = false;
  }
});

closeMediaModalButton.addEventListener("click", closeMediaModal);
mediaModal.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-media-modal")) {
    closeMediaModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mediaModal.hidden) {
    closeMediaModal();
  }
});

async function bootstrap() {
  resetResultState();
  await Promise.all([loadHealth(), loadHistory()]);
}

function setSelectedFile(file) {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    selectedFile = null;
    analyzeButton.disabled = true;
    fileInput.value = "";
    if (selectedObjectUrl) {
      URL.revokeObjectURL(selectedObjectUrl);
      selectedObjectUrl = null;
    }
    renderFailure(new Error("Please choose an image or video file."));
    return;
  }

  selectedFile = file;
  analyzeButton.disabled = false;

  if (selectedObjectUrl) {
    URL.revokeObjectURL(selectedObjectUrl);
  }

  selectedObjectUrl = URL.createObjectURL(file);
  renderPreview(file, selectedObjectUrl);
  fileMetaValue.textContent = `${file.name} • ${formatFileSize(file.size)}`;
}

function renderPreview(file, objectUrl) {
  previewContainer.className = "preview-box";
  setCurrentPreviewMedia({
    url: objectUrl,
    type: file.type,
    name: file.name,
    sizeLabel: formatFileSize(file.size),
    sourceLabel: "Current browser upload"
  });

  if (file.type.startsWith("video/")) {
    previewContainer.innerHTML = `
      <video controls muted playsinline preload="metadata">
        <source src="${objectUrl}" type="${file.type}">
      </video>
    `;
    return;
  }

  previewContainer.innerHTML = `<img src="${objectUrl}" alt="Uploaded media preview" />`;
}

function renderStoredPreview(file) {
  const media = resolveMediaDescriptor(file);
  setCurrentPreviewMedia(media);

  if (file.sessionAssetUrl && file.type.startsWith("video/")) {
    previewContainer.className = "preview-box";
    previewContainer.innerHTML = `
      <video controls playsinline preload="metadata">
        <source src="${escapeHtml(file.sessionAssetUrl)}" type="${escapeHtml(file.type)}">
      </video>
    `;
    return;
  }

  if (file.sessionAssetUrl) {
    previewContainer.className = "preview-box";
    previewContainer.innerHTML = `
      <img src="${escapeHtml(file.sessionAssetUrl)}" alt="${escapeHtml(file.name)}" />
    `;
    return;
  }

  if (file.assetPath && file.type.startsWith("video/")) {
    previewContainer.className = "preview-box";
    previewContainer.innerHTML = `
      <video controls playsinline preload="metadata" ${file.previewImage ? `poster="${escapeHtml(file.previewImage)}"` : ""}>
        <source src="${escapeHtml(file.assetPath)}" type="${escapeHtml(file.type)}">
      </video>
    `;
    return;
  }

  if (file.assetPath) {
    previewContainer.className = "preview-box";
    previewContainer.innerHTML = `
      <img src="${escapeHtml(file.assetPath)}" alt="${escapeHtml(file.name)}" />
    `;
    return;
  }

  if (file.previewImage) {
    previewContainer.className = "preview-box";
    previewContainer.innerHTML = `
      <img src="${escapeHtml(file.previewImage)}" alt="${escapeHtml(file.name)}" />
    `;
    return;
  }

  previewContainer.className = "preview-empty";
  previewContainer.innerHTML = `
    <div class="preview-placeholder">
      <div>
        <p>${escapeHtml(file.name)}</p>
        <p>${escapeHtml(file.type)} • ${escapeHtml(file.sizeLabel)}</p>
      </div>
    </div>
  `;
}

function setLoadingState(file) {
  verdictTitle.textContent = "Analyzing...";
  summaryText.textContent =
    "Extracting forensic features locally, sending them to the shared API, and generating or reusing a cached case report.";
  scorePill.textContent = "...";
  scorePill.className = "score-pill";
  meterFill.style.width = "12%";
  caseIdValue.textContent = "Pending";
  fileMetaValue.textContent = `${file.name} • ${formatFileSize(file.size)}`;
  hashValue.textContent = "Computing...";
  engineValue.textContent = "Mythraze Forensic Ensemble";
  downloadReportButton.disabled = true;
  renderSignals(
    defaultSignals.map((signal) => ({
      ...signal,
      score: "..."
    }))
  );
  pipelineList.innerHTML = [
    "Media validated locally.",
    "Feature extraction in progress.",
    "Awaiting backend verdict.",
    "Report generation pending."
  ]
    .map((item) => `<li>${item}</li>`)
    .join("");
  recommendationsList.innerHTML = "<li>Recommendations will appear after scoring.</li>";
  insightsList.innerHTML = "<li>Preparing forensic analysis pipeline...</li>";
}

function resetResultState() {
  currentAnalysisId = null;
  setCurrentPreviewMedia(null);
  verdictTitle.textContent = "Awaiting upload";
  summaryText.textContent = "Upload a media file to begin full workflow analysis.";
  scorePill.textContent = "--";
  scorePill.className = "score-pill";
  meterFill.style.width = "0%";
  caseIdValue.textContent = "--";
  fileMetaValue.textContent = "--";
  hashValue.textContent = "--";
  engineValue.textContent = "--";
  renderSignals(defaultSignals);
  pipelineList.innerHTML = "<li>No pipeline run yet.</li>";
  recommendationsList.innerHTML = "<li>No recommendations yet.</li>";
  insightsList.innerHTML = "<li>No analysis yet.</li>";
  downloadReportButton.disabled = true;
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error("Backend health check failed");
    }

    const health = await response.json();
    backendStatusText.textContent = health.api === "online" ? "Online" : "Offline";
    backendStatusText.className = health.api === "online" ? "status-low" : "status-high";
    backendSummaryText.textContent = health.lastCaseAt
      ? `Shared API ready. ${health.cacheEntries} cached fingerprints, ${health.inFlightAnalyses} in flight, ${health.cacheHitRate}% cache-hit rate. Latest case at ${formatDateTime(health.lastCaseAt)}.`
      : `Shared API ready. ${health.cacheEntries} cached fingerprints and ${health.inFlightAnalyses} in flight.`;
    storedCasesValue.textContent = String(health.storedCases);
    engineModeValue.textContent = `${health.apiMode} • ${health.engine}`;
  } catch (error) {
    backendStatusText.textContent = "Offline";
    backendStatusText.className = "status-high";
    backendSummaryText.textContent = "Backend unavailable. Start the local server to enable the full workflow.";
    storedCasesValue.textContent = "0";
    engineModeValue.textContent = "Unavailable";
  }
}

async function loadHistory() {
  try {
    const response = await fetch("/api/analyses");
    if (!response.ok) {
      throw new Error("Unable to fetch analysis history");
    }

    const payload = await response.json();
    demoHistoryItems = payload.demoItems || [];
    renderHistory();
  } catch (error) {
    demoHistoryItems = [];
    renderHistory();
    historyList.innerHTML = `
      <article class="history-empty">
        <p>Demo gallery unavailable while the backend is offline.</p>
      </article>
    `;
  }
}

function renderHistory() {
  renderHistoryGroup(historyList, demoHistoryItems, "No demo investigations available.", "demo");
  renderHistoryGroup(
    userHistoryList,
    sessionHistory,
    "Your uploaded investigations will appear here for this session only.",
    "session"
  );
}

function renderHistoryGroup(container, items, emptyMessage, mode) {
  if (!items.length) {
    container.innerHTML = `
      <article class="history-empty">
        <p>${escapeHtml(emptyMessage)}</p>
      </article>
    `;
    return;
  }

  container.innerHTML = items.map(buildHistoryCard).join("");

  container.querySelectorAll("[data-preview-analysis-id]").forEach((button) => {
    const openPreview = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const analysisId = button.getAttribute("data-preview-analysis-id");
      const item = items.find((candidate) => candidate.id === analysisId);
      if (!item) {
        return;
      }

      const media = resolveMediaDescriptor(item.file);
      if (media) {
        openMediaModal(media);
      }
    };

    button.addEventListener("click", openPreview);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        openPreview(event);
      }
    });
  });

  container.querySelectorAll("[data-analysis-id]").forEach((card) => {
    const openSavedAnalysis = async () => {
      const analysisId = card.getAttribute("data-analysis-id");

      if (mode === "session") {
        const analysis = getSessionHistoryAnalysis(analysisId);
        if (!analysis) {
          renderFailure(new Error("Unable to load saved analysis"));
          return;
        }

        renderResult(analysis, { fromHistory: true });
        document
          .getElementById("analyzer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      try {
        const response = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}`);
        if (!response.ok) {
          throw new Error("Unable to load saved analysis");
        }
        const analysis = await response.json();
        renderResult(analysis, { fromHistory: true });
        document
          .getElementById("analyzer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        renderFailure(error);
      }
    };

    card.addEventListener("click", openSavedAnalysis);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSavedAnalysis();
      }
    });
  });
}

function buildHistoryCard(item) {
  return `
    <article
      class="history-item"
      data-analysis-id="${escapeHtml(item.id)}"
      role="button"
      tabindex="0"
      aria-label="Open saved investigation for ${escapeHtml(item.file.name)}"
    >
      <div class="history-media ${hasHistoryMedia(item.file) ? "" : "history-media-placeholder"}">
        ${buildHistoryMediaMarkup(item)}
        ${
          hasHistoryMedia(item.file)
            ? `<button
                type="button"
                class="history-media-action"
                data-preview-analysis-id="${escapeHtml(item.id)}"
                aria-label="View full media for ${escapeHtml(item.file.name)}"
              >
                View Media
              </button>`
            : ""
        }
      </div>
      <div class="history-item-header">
        <div class="history-chip-row">
          <span class="history-tag">${escapeHtml(item.mediaType.toUpperCase())}</span>
          ${
            item.file.isDemo
              ? '<span class="history-tag history-tag-demo">DEMO</span>'
              : '<span class="history-tag history-tag-user">UPLOAD</span>'
          }
        </div>
        <span class="status-chip status-${escapeHtml(item.verdict.level)}">
          ${escapeHtml(item.verdict.label)}
        </span>
      </div>
      <strong>${escapeHtml(item.file.name)}</strong>
      <p>${escapeHtml(item.summary)}</p>
      ${
        item.file.sourceLabel
          ? `<span class="history-source">${escapeHtml(item.file.sourceLabel)}</span>`
          : ""
      }
      ${
        item.groundTruth
          ? `<span class="history-source history-source-truth">${escapeHtml(item.groundTruth.label)}</span>`
          : ""
      }
      <div class="history-item-footer">
        <span>${escapeHtml(item.confidence)}% risk</span>
        <span>${escapeHtml(item.requestCount)} shared hits</span>
        <span>${escapeHtml(formatDateTime(item.createdAt))}</span>
      </div>
    </article>
  `;
}

async function submitAnalysis(payload) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Analysis request failed");
  }

  return result;
}

function renderResult(result, options = {}) {
  currentAnalysisId = result.id;
  verdictTitle.textContent = result.verdict.label;
  const groundTruthPrefix = result.groundTruth
    ? `${result.groundTruth.label}. `
    : "";
  if (result.api?.responseMode === "history") {
    summaryText.textContent = `${groundTruthPrefix}${result.summary} Loaded from saved investigation history.`;
  } else if (result.api?.cacheHit) {
    summaryText.textContent = `${groundTruthPrefix}${result.summary} Served from the shared API cache for faster repeat access.`;
  } else {
    summaryText.textContent = `${groundTruthPrefix}${result.summary} Fresh verdict generated by the shared API.`;
  }
  scorePill.textContent = `${result.confidence}%`;
  scorePill.className = `score-pill status-${result.verdict.level}`;
  meterFill.style.width = `${result.confidence}%`;
  caseIdValue.textContent = result.id;
  fileMetaValue.textContent = `${result.file.name} • ${result.file.sizeLabel}`;
  hashValue.textContent = shortenHash(result.file.hash);
  engineValue.textContent = `${result.engine.name} ${result.engine.version} • ${result.api?.responseMode || "fresh"}`;
  downloadReportButton.disabled = false;
  renderSignals(
    result.signals.map((signal) => ({
      title: signal.title,
      score: `${signal.value}%`,
      description: signal.description,
      level: signal.level
    }))
  );
  const pipelineEntries = [];
  if (result.api && result.api.cacheHit) {
    pipelineEntries.push(
      `<li><strong>Shared API Cache:</strong> Matching fingerprint reused with ${escapeHtml(String(result.api.requestCount))} total requests.</li>`
    );
  }
  pipelineEntries.push(
    ...result.pipeline.map(
      (stage) =>
        `<li><strong>${escapeHtml(stage.stage)}:</strong> ${escapeHtml(stage.detail)} (${escapeHtml(stage.metric)})</li>`
    )
  );
  pipelineList.innerHTML = pipelineEntries.join("");
  recommendationsList.innerHTML = result.recommendations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  insightsList.innerHTML = result.insights
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  if (options.fromHistory) {
    selectedFile = null;
    fileInput.value = "";
    analyzeButton.disabled = true;
    if (selectedObjectUrl) {
      URL.revokeObjectURL(selectedObjectUrl);
      selectedObjectUrl = null;
    }
    renderStoredPreview(result.file);
  }
}

function renderFailure(error) {
  setCurrentPreviewMedia(null);
  verdictTitle.textContent = "Analysis failed";
  summaryText.textContent =
    "The media could not be processed. Try another file or re-run the backend server.";
  scorePill.textContent = "ERR";
  scorePill.className = "score-pill status-high";
  meterFill.style.width = "0%";
  caseIdValue.textContent = "--";
  hashValue.textContent = "--";
  engineValue.textContent = "--";
  downloadReportButton.disabled = true;
  renderSignals(defaultSignals);
  pipelineList.innerHTML = "<li>Pipeline did not complete.</li>";
  recommendationsList.innerHTML = "<li>Retry with a supported image or a shorter video clip.</li>";
  insightsList.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
}

function renderSignals(signals) {
  signalsGrid.innerHTML = signals
    .map(
      (signal) => `
        <article class="signal-card">
          <span>${escapeHtml(signal.title)}</span>
          <strong class="${signal.level ? `status-${escapeHtml(signal.level)}` : ""}">
            ${escapeHtml(signal.score)}
          </strong>
          <p>${escapeHtml(signal.description)}</p>
        </article>
      `
    )
    .join("");
}

function createSessionAnalysisEntry(analysis, file) {
  const sessionAssetUrl = URL.createObjectURL(file);
  const entry = cloneRecord(analysis);
  entry.file = {
    ...entry.file,
    sessionAssetUrl,
    sourceLabel: "Session upload",
    isDemo: false
  };
  return entry;
}

function upsertSessionHistory(entry) {
  const existingIndex = sessionHistory.findIndex((item) => item.id === entry.id);
  if (existingIndex >= 0) {
    revokeSessionAssetUrl(sessionHistory[existingIndex]);
    sessionHistory.splice(existingIndex, 1);
  }

  sessionHistory.unshift(entry);
  sessionHistoryById.set(entry.id, entry);
}

function getSessionHistoryAnalysis(analysisId) {
  const analysis = sessionHistoryById.get(analysisId);
  if (!analysis) {
    return null;
  }

  const clone = cloneRecord(analysis);
  clone.api = {
    ...(clone.api || {}),
    sharedApi: true,
    cacheHit: false,
    responseMode: "history"
  };
  return clone;
}

function revokeSessionAssetUrl(entry) {
  if (entry?.file?.sessionAssetUrl) {
    URL.revokeObjectURL(entry.file.sessionAssetUrl);
  }
}

function hasHistoryMedia(file) {
  return Boolean(file.sessionAssetUrl || file.assetPath || file.previewImage);
}

function resolveMediaDescriptor(file) {
  if (!file) {
    return null;
  }

  const mediaUrl = file.sessionAssetUrl || file.assetPath || file.previewImage || "";
  if (!mediaUrl) {
    return null;
  }

  return {
    url: mediaUrl,
    type: file.assetPath || file.sessionAssetUrl ? file.type : "image/jpeg",
    name: file.name,
    sizeLabel: file.sizeLabel || "",
    sourceLabel: file.sourceLabel || "",
    poster: file.previewImage || ""
  };
}

function setCurrentPreviewMedia(media) {
  currentPreviewMedia = media;
  viewPreviewButton.disabled = !media;
}

function openMediaModal(media) {
  if (!media?.url) {
    return;
  }

  const metaParts = [];
  metaParts.push(media.type.startsWith("video/") ? "Video" : "Image");
  if (media.sizeLabel) {
    metaParts.push(media.sizeLabel);
  }
  if (media.sourceLabel) {
    metaParts.push(media.sourceLabel);
  }

  mediaModalTitle.textContent = media.name || "Saved investigation media";
  mediaModalMeta.textContent = metaParts.join(" • ");
  mediaModalContent.innerHTML = media.type.startsWith("video/")
    ? `
      <video controls playsinline preload="metadata" ${media.poster ? `poster="${escapeHtml(media.poster)}"` : ""}>
        <source src="${escapeHtml(media.url)}" type="${escapeHtml(media.type)}">
      </video>
    `
    : `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.name || "Investigation media")}" />`;
  mediaModal.hidden = false;
  mediaModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeMediaModal() {
  mediaModal.hidden = true;
  mediaModal.setAttribute("aria-hidden", "true");
  mediaModalContent.innerHTML = "";
  document.body.classList.remove("modal-open");
}

function buildHistoryMediaMarkup(item) {
  const mediaUrl = item.file.sessionAssetUrl || item.file.assetPath || "";

  if (mediaUrl && item.mediaType === "video") {
    return `<video class="history-thumb history-video-thumb" muted playsinline autoplay loop preload="metadata">
      <source src="${escapeHtml(mediaUrl)}" type="${escapeHtml(item.file.type)}">
    </video>`;
  }

  if (mediaUrl) {
    return `<img class="history-thumb" src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(item.file.name)}" />`;
  }

  if (item.file.previewImage) {
    return `<img class="history-thumb" src="${escapeHtml(item.file.previewImage)}" alt="${escapeHtml(item.file.name)}" />`;
  }

  return `<div class="history-thumb-fallback">${escapeHtml(item.mediaType.toUpperCase())}</div>`;
}

async function extractImageMetrics(file) {
  const imageSource = await loadImageSource(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const dimensions = fitDimensions(imageSource.width, imageSource.height, 360);

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  context.drawImage(imageSource, 0, 0, dimensions.width, dimensions.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const previewImage = createPreviewDataUrl(canvas);
  if (typeof imageSource.close === "function") {
    imageSource.close();
  }

  return {
    mediaType: "image",
    metrics: computeImageMetrics(imageData),
    previewImage,
    extraContext: {
      frameCount: 1,
      duration: 0,
      width: imageSource.width,
      height: imageSource.height
    }
  };
}

async function extractVideoMetrics(file) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;

  await waitForEvent(video, "loadedmetadata");

  const frameCount = Math.max(4, Math.min(8, Math.floor(video.duration || 4)));
  const timestamps = Array.from({ length: frameCount }, (_, index) => {
    if (!video.duration || frameCount === 1) {
      return 0;
    }
    return (video.duration * index) / (frameCount - 1);
  });

  const perFrameMetrics = [];
  let previewImage = "";
  for (const timestamp of timestamps) {
    await seekVideo(video, timestamp);
    const frameSample = sampleVideoFrame(video);
    perFrameMetrics.push(frameSample.metrics);
    if (!previewImage) {
      previewImage = frameSample.previewImage;
    }
  }

  URL.revokeObjectURL(objectUrl);

  return {
    mediaType: "video",
    metrics: aggregateVideoMetrics(perFrameMetrics),
    previewImage,
    extraContext: {
      frameCount,
      duration: video.duration || 0,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0
    }
  };
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  await waitForEvent(image, "load");
  URL.revokeObjectURL(objectUrl);
  return image;
}

function sampleVideoFrame(video) {
  const dimensions = fitDimensions(video.videoWidth, video.videoHeight, 320);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    metrics: computeImageMetrics(imageData),
    previewImage: createPreviewDataUrl(canvas)
  };
}

function aggregateVideoMetrics(frames) {
  const keys = [
    "noiseScore",
    "blockinessScore",
    "bandingScore",
    "edgeChaos",
    "textureVariance",
    "symmetryScore",
    "averageColorDelta",
    "rowVariance"
  ];
  const aggregate = {};

  keys.forEach((key) => {
    aggregate[key] = average(frames.map((frame) => frame[key]));
  });

  aggregate.temporalInstability = computeFrameFlicker(frames);
  return aggregate;
}

function computeFrameFlicker(frames) {
  if (frames.length < 2) {
    return 0;
  }

  const deltas = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const delta =
      Math.abs(current.noiseScore - previous.noiseScore) * 0.35 +
      Math.abs(current.edgeChaos - previous.edgeChaos) * 0.25 +
      Math.abs(current.textureVariance - previous.textureVariance) * 0.25 +
      Math.abs(current.blockinessScore - previous.blockinessScore) * 0.15;
    deltas.push(delta);
  }

  return clamp01(average(deltas) / 0.18);
}

function computeImageMetrics(imageData) {
  const { data, width, height } = imageData;
  const grayscale = new Float32Array(width * height);
  const rowBrightness = new Float32Array(height);
  const colorDelta = [];
  let blockinessAccumulator = 0;
  let edgeAccumulator = 0;
  let gradientSamples = 0;
  let noiseAccumulator = 0;
  let textureEnergy = 0;
  let symmetryAccumulator = 0;
  let symmetrySamples = 0;
  let bandingCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      grayscale[y * width + x] = gray;
      rowBrightness[y] += gray;

      if (x > 0) {
        const leftIndex = index - 4;
        colorDelta.push(
          Math.abs(r - data[leftIndex]) +
            Math.abs(g - data[leftIndex + 1]) +
            Math.abs(b - data[leftIndex + 2])
        );
      }

      if (x > 0 && y > 0) {
        const gx = gray - grayscale[y * width + (x - 1)];
        const gy = gray - grayscale[(y - 1) * width + x];
        const gradient = Math.sqrt(gx * gx + gy * gy);
        edgeAccumulator += gradient;
        textureEnergy += Math.abs(gx) + Math.abs(gy);
        gradientSamples += 1;

        const predicted =
          (grayscale[y * width + (x - 1)] + grayscale[(y - 1) * width + x]) / 2;
        noiseAccumulator += Math.abs(gray - predicted);
      }

      if (x > width / 2) {
        const mirrorX = width - x - 1;
        const mirrorGray = grayscale[y * width + mirrorX];
        if (mirrorGray) {
          symmetryAccumulator += Math.abs(gray - mirrorGray);
          symmetrySamples += 1;
        }
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    rowBrightness[y] /= width;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gray = grayscale[y * width + x];
      if (x > 0 && x % 8 === 0) {
        blockinessAccumulator += Math.abs(gray - grayscale[y * width + (x - 1)]);
      }
      if (y > 0 && y % 8 === 0) {
        blockinessAccumulator += Math.abs(gray - grayscale[(y - 1) * width + x]);
      }
      if (x > 0) {
        const delta = Math.abs(gray - grayscale[y * width + (x - 1)]);
        if (delta > 0 && delta < 2.2) {
          bandingCount += 1;
        }
      }
    }
  }

  const normalizedEdges = gradientSamples ? edgeAccumulator / gradientSamples : 0;
  const normalizedNoise = gradientSamples ? noiseAccumulator / gradientSamples : 0;
  const normalizedTexture = gradientSamples ? textureEnergy / gradientSamples : 0;
  const blockinessScore = clamp01(blockinessAccumulator / (width * height * 3.6));
  const noiseScore = clamp01((18 - normalizedNoise) / 18);
  const bandingScore = clamp01(bandingCount / (width * height * 0.18));
  const edgeChaos = clamp01(normalizedEdges / 42);
  const textureVariance = clamp01(normalizedTexture / 60);
  const symmetryScore = symmetrySamples
    ? clamp01(1 - symmetryAccumulator / (symmetrySamples * 60))
    : 0.5;

  return {
    noiseScore,
    blockinessScore,
    bandingScore,
    edgeChaos,
    textureVariance,
    symmetryScore,
    averageColorDelta: average(colorDelta) || 0,
    rowVariance: variance(Array.from(rowBrightness)) || 0
  };
}

function createPreviewDataUrl(canvas) {
  try {
    return canvas.toDataURL("image/jpeg", 0.74);
  } catch (error) {
    return "";
  }
}

function cloneRecord(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

async function computeFileHash(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fitDimensions(width, height, maxDimension) {
  const largest = Math.max(width, height);
  if (!largest || largest <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (!values.length) {
    return 0;
  }
  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortenHash(hash) {
  if (!hash) {
    return "--";
  }
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    function onResolve() {
      cleanup();
      resolve();
    }

    function onReject() {
      cleanup();
      reject(new Error(`Unable to process media: ${eventName} failed.`));
    }

    function cleanup() {
      target.removeEventListener(eventName, onResolve);
      target.removeEventListener("error", onReject);
    }

    target.addEventListener(eventName, onResolve, { once: true });
    target.addEventListener("error", onReject, { once: true });
  });
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    function onSeeked() {
      cleanup();
      resolve();
    }

    function onError() {
      cleanup();
      reject(new Error("Unable to sample one or more video frames."));
    }

    function cleanup() {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    }

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.min(
      Math.max(time, 0),
      Math.max((video.duration || 0) - 0.05, 0)
    );
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
