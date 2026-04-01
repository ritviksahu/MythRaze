const crypto = require("crypto");
const ENGINE_VERSION = "2.2-calibrated";

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

function buildSignal(title, value, description) {
  return {
    title,
    value: Math.round(value * 100),
    level: classifyRisk(value).level,
    description
  };
}

function classifyRisk(score) {
  if (score >= 0.6) {
    return { label: "High Manipulation Risk", level: "high" };
  }
  if (score >= 0.38) {
    return { label: "Needs Human Review", level: "medium" };
  }
  return { label: "Likely Authentic", level: "low" };
}

function buildSummary(verdict, mediaType, confidence) {
  if (verdict.level === "high") {
    return `This ${mediaType} shows several forensic anomalies associated with synthetic or manipulated media and should be treated as likely fake. Combined risk confidence is ${confidence}%.`;
  }

  if (verdict.level === "medium") {
    return `This ${mediaType} contains a mixed forensic signature. It may be genuine, but it should be verified manually before use in a high-trust workflow.`;
  }

  return `This ${mediaType} appears relatively consistent across the current forensic checks. It is likely authentic, although automated analysis can never guarantee certainty.`;
}

function computeResolutionRisk(mediaType, extraContext = {}) {
  const width = Number(extraContext.width) || 0;
  const height = Number(extraContext.height) || 0;

  if (!width || !height) {
    return mediaType === "video" ? 0.18 : 0.1;
  }

  const pixels = width * height;
  const largest = Math.max(width, height);

  if (pixels <= 256 * 256) {
    return 0.9;
  }
  if (pixels <= 512 * 512) {
    return 0.76;
  }
  if (largest <= 720) {
    return mediaType === "video" ? 0.5 : 0.42;
  }
  if (largest <= 1080) {
    return 0.22;
  }

  return 0.06;
}

function buildInsights({
  verdict,
  confidence,
  mediaType,
  metrics,
  extraContext,
  resolutionRisk
}) {
  const notes = [];

  notes.push(
    `Manipulation risk is classified as ${verdict.label.toLowerCase()} with ${confidence}% ensemble confidence.`
  );

  if (metrics.noiseScore > 0.65) {
    notes.push(
      "Noise structure appears unusually smooth, which is a common cue in AI-generated or aggressively retouched media."
    );
  } else {
    notes.push(
      "Noise distribution remains closer to natural capture behavior and does not strongly suggest synthetic smoothing."
    );
  }

  if (metrics.blockinessScore > 0.55 || metrics.bandingScore > 0.55) {
    notes.push(
      "Compression and tonal transitions show anomalies that often appear after re-encoding, compositing, or generative post-processing."
    );
  } else {
    notes.push(
      "Compression patterns are comparatively stable and do not indicate strong edit boundaries."
    );
  }

  if (
    metrics.edgeChaos > 0.72 ||
    Math.abs(metrics.edgeChaos - metrics.textureVariance) > 0.28
  ) {
    notes.push(
      "Edge-to-texture mismatch suggests localized enhancement or generated detail insertion in some regions."
    );
  } else {
    notes.push(
      "Edge detail and texture energy remain reasonably aligned, which is more typical of untouched media."
    );
  }

  if (mediaType === "video") {
    notes.push(
      `Temporal inspection sampled ${extraContext.frameCount} frames across ${Math.round(
        extraContext.duration || 0
      )} seconds.`
    );
    if ((metrics.temporalInstability || 0) > 0.45) {
      notes.push(
        "Frame stability is elevated, which can indicate flicker-like deepfake artifacts or inconsistent generative rendering."
      );
    } else {
      notes.push(
        "Frame-to-frame consistency is reasonably stable for the sampled interval."
      );
    }
  } else {
    notes.push(
      `Still-image analysis processed a single frame and evaluated spatial and compression signals only.`
    );
  }

  if (resolutionRisk > 0.65) {
    notes.push(
      "Very low native resolution reduces natural detail and increases the likelihood of synthetic or heavily processed content."
    );
  }

  return notes;
}

function buildRecommendations(verdict, mediaType, metrics, resolutionRisk) {
  const actions = [];

  if (verdict.level === "high") {
    actions.push("Escalate this case for manual review before sharing, publishing, or moderation approval.");
    actions.push("Cross-check the source with reverse search, sender verification, or original capture metadata.");
    actions.push("Compare suspicious regions against trusted reference imagery or frame captures.");
  } else if (verdict.level === "medium") {
    actions.push("Mark this case for secondary review instead of auto-approving it.");
    actions.push("Validate origin, capture context, and prior upload history before trust or redistribution.");
    actions.push("Inspect the highest-risk regions manually if the media will inform a sensitive decision.");
  } else {
    actions.push("No strong manipulation cues were found, but keep standard provenance checks in place.");
    actions.push("Archive this report as a baseline authenticity review for later comparison.");
    actions.push("Re-run analysis if a higher-resolution source file becomes available.");
  }

  if (mediaType === "video" && (metrics.temporalInstability || 0) > 0.45) {
    actions.push("Review facial regions and moving edges frame by frame for flicker or warping.");
  }

  if (resolutionRisk > 0.65) {
    actions.push("Request a higher-resolution source because low-detail media can hide edit traces and synthetic artifacts.");
  }

  return actions.slice(0, 4);
}

function buildPipeline(signals, confidence, mediaType, extraContext, clientProcessingMs) {
  const signalMap = Object.fromEntries(signals.map((signal) => [signal.title, signal.value]));

  return [
    {
      stage: "Media Intake",
      detail: `${mediaType === "video" ? "Video" : "Image"} validated and fingerprinted for case tracking.`,
      status: "complete",
      metric: extraContext.fileHash ? `${extraContext.fileHash.slice(0, 12)}...` : "Ready"
    },
    {
      stage: "Feature Extraction",
      detail:
        mediaType === "video"
          ? `Sampled ${extraContext.frameCount} frames and extracted spatial plus temporal forensic features.`
          : "Extracted spatial, tonal, and compression-oriented forensic features.",
      status: "complete",
      metric: `${Math.round(clientProcessingMs || 0)} ms`
    },
    {
      stage: "Ensemble Scoring",
      detail: "Combined artifact, compression, consistency, and temporal signals into a single verdict.",
      status: "complete",
      metric: `${confidence}% risk`
    },
    {
      stage: "Operational Triage",
      detail: "Generated an explainable report and recommended next actions for reviewers.",
      status: "complete",
      metric: `${signalMap["Artifact Risk"] || 0}/${signalMap["Compression Risk"] || 0}/${signalMap["Consistency Risk"] || 0}/${signalMap["Temporal Risk"] || 0}`
    }
  ];
}

function buildAnalysisRecord(payload) {
  const {
    fileName,
    fileType,
    fileSize,
    fileHash,
    previewImage,
    mediaType,
    metrics,
    extraContext = {},
    clientProcessingMs = 0
  } = payload;

  const averageColorDelta = metrics.averageColorDelta || 0;
  const rowVariance = metrics.rowVariance || 0;
  const resolutionRisk = computeResolutionRisk(mediaType, extraContext);
  const edgeTextureMismatch = clamp01(
    Math.abs(metrics.edgeChaos - metrics.textureVariance) * 1.55
  );
  const smoothingRisk = clamp01(
    metrics.noiseScore * 0.62 + (1 - metrics.textureVariance) * 0.38
  );

  const artifactRisk = clamp01(
    smoothingRisk * 0.46 +
      edgeTextureMismatch * 0.28 +
      metrics.edgeChaos * 0.14 +
      metrics.bandingScore * 0.12
  );

  const compressionRisk = clamp01(
    metrics.blockinessScore * 0.4 +
      metrics.bandingScore * 0.3 +
      clamp01(averageColorDelta / 40) * 0.15 +
      resolutionRisk * 0.15
  );

  const consistencyRisk = clamp01(
    (1 - metrics.symmetryScore) * 0.24 +
      clamp01(rowVariance / 320) * 0.3 +
      edgeTextureMismatch * 0.28 +
      resolutionRisk * 0.18
  );

  const temporalRisk =
    mediaType === "video"
      ? clamp01(
          (metrics.temporalInstability || 0) * 0.76 +
            edgeTextureMismatch * 0.14 +
            smoothingRisk * 0.1
        )
      : 0.05;

  let syntheticCueBoost = 0;
  if (metrics.noiseScore > 0.68 && metrics.textureVariance < 0.38) {
    syntheticCueBoost += 0.12;
  }
  if (metrics.blockinessScore > 0.42 && metrics.bandingScore > 0.42) {
    syntheticCueBoost += 0.08;
  }
  if (edgeTextureMismatch > 0.4) {
    syntheticCueBoost += 0.06;
  }
  if (resolutionRisk > 0.68) {
    syntheticCueBoost += 0.08;
  }
  if (mediaType === "video" && (metrics.temporalInstability || 0) > 0.42) {
    syntheticCueBoost += 0.12;
  }

  const overallRisk = clamp01(
    artifactRisk * 0.3 +
      compressionRisk * 0.23 +
      consistencyRisk * 0.2 +
      temporalRisk * 0.17 +
      resolutionRisk * 0.1 +
      syntheticCueBoost
  );

  const verdict = classifyRisk(overallRisk);
  const confidence = Math.round(overallRisk * 100);
  const createdAt = new Date().toISOString();
  const id = `TL-${createdAt.slice(0, 10).replace(/-/g, "")}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;

  const signals = [
    buildSignal("Artifact Risk", artifactRisk, "Texture, edge, and generation cues."),
    buildSignal(
      "Compression Risk",
      compressionRisk,
      "Blockiness, banding, and re-encoding indicators."
    ),
    buildSignal(
      "Consistency Risk",
      consistencyRisk,
      "Regional coherence and spatial stability across the media."
    ),
    buildSignal(
      "Temporal Risk",
      temporalRisk,
      mediaType === "video"
        ? "Frame-to-frame stability and flicker behavior."
        : "Near-zero weight for still imagery."
    )
  ];

  const context = {
    frameCount: extraContext.frameCount || 1,
    duration: extraContext.duration || 0,
    width: extraContext.width || 0,
    height: extraContext.height || 0,
    fileHash
  };

  return {
    id,
    createdAt,
    mediaType,
    summary: buildSummary(verdict, mediaType, confidence),
    verdict,
    confidence,
    signals,
    insights: buildInsights({
      verdict,
      confidence,
      mediaType,
      metrics,
      extraContext: context,
      resolutionRisk
    }),
    recommendations: buildRecommendations(verdict, mediaType, metrics, resolutionRisk),
    pipeline: buildPipeline(signals, confidence, mediaType, context, clientProcessingMs),
    file: {
      name: fileName,
      type: fileType,
      sizeBytes: fileSize,
      sizeLabel: formatFileSize(fileSize),
      hash: fileHash,
      previewImage: previewImage || "",
      sourceLabel: "User upload",
      isDemo: false
    },
    metrics: {
      noiseScore: Math.round(metrics.noiseScore * 100),
      blockinessScore: Math.round(metrics.blockinessScore * 100),
      bandingScore: Math.round(metrics.bandingScore * 100),
      edgeChaos: Math.round(metrics.edgeChaos * 100),
      textureVariance: Math.round(metrics.textureVariance * 100),
      symmetryScore: Math.round(metrics.symmetryScore * 100),
      temporalInstability: Math.round((metrics.temporalInstability || 0) * 100)
    },
    engine: {
      name: "Mythraze Forensic Ensemble",
      version: ENGINE_VERSION,
      mode: "Browser extraction + shared server orchestration"
    },
    extraContext: {
      frameCount: context.frameCount,
      duration: context.duration,
      width: context.width,
      height: context.height,
      clientProcessingMs: Math.round(clientProcessingMs || 0)
    }
  };
}

module.exports = {
  buildAnalysisRecord,
  ENGINE_VERSION
};
