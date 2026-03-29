const BRAILLE_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BOOT_CONFIG = typeof window !== "undefined" && window.__PI_STUDIO_OPENCODE_BOOT__ && typeof window.__PI_STUDIO_OPENCODE_BOOT__ === "object"
  ? window.__PI_STUDIO_OPENCODE_BOOT__
  : {};
const STUDIO_ACCESS_TOKEN = typeof BOOT_CONFIG.token === "string" ? BOOT_CONFIG.token : "";

const state = {
  snapshot: null,
  stableCurrentModel: null,
  selectedPromptId: null,
  activePane: "left",
  paneFocusTarget: "off",
  busy: false,
  followLatest: true,
  diagnosticsOpen: false,
  rightView: "preview",
  editorOriginLabel: "studio editor",
  sourcePath: null,
  uploadFileName: "",
  workingDir: "",
  workingDirDraft: "",
  workingDirEditorOpen: false,
  editorHighlightEnabled: true,
  responseHighlightEnabled: true,
  editorLanguage: "markdown",
  annotationsEnabled: true,
  editorHighlightRenderRaf: null,
  lastLoadedIntoEditorNormalized: "",
  windowHasFocus: typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : true,
  titleAttentionMessage: "",
  titleAttentionTimer: null,
  lastAppliedDocumentTitle: "",
  initialSnapshotLoaded: false,
  lastCompletedTurnKey: "",
  transientStatus: null,
  transientStatusTimer: null,
  spinnerTimer: null,
  spinnerFrameIndex: 0,
  responsePreviewRenderNonce: 0,
  responsePreviewTimer: null,
  currentRenderedPreviewKey: "",
  pendingResponseScrollReset: false,
  lastResponseIdentityKey: "",
  snapshotPollTimer: null,
  snapshotPollInFlight: false,
  pdfExportInProgress: false,
};

const MATHJAX_CDN_URL = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
const PDFJS_CDN_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs";
const PDFJS_WORKER_CDN_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs";
const MATHJAX_UNAVAILABLE_MESSAGE = "Math fallback unavailable. Some unsupported equations may remain as raw TeX.";
const MATHJAX_RENDER_FAIL_MESSAGE = "Math fallback could not render some unsupported equations.";
const PDF_PREVIEW_UNAVAILABLE_MESSAGE = "PDF figure preview unavailable. Inline PDF rendering is not supported in this browser environment.";
const PDF_PREVIEW_RENDER_FAIL_MESSAGE = "PDF figure preview could not be rendered.";
let mathJaxPromise = null;
let pdfJsPromise = null;

const EDITOR_HIGHLIGHT_MAX_CHARS = 100_000;
const RESPONSE_HIGHLIGHT_MAX_CHARS = 120_000;
const EDITOR_HIGHLIGHT_STORAGE_KEY = "studioPrototype.editorHighlightEnabled";
const RESPONSE_HIGHLIGHT_STORAGE_KEY = "studioPrototype.responseHighlightEnabled";
const EDITOR_LANGUAGE_STORAGE_KEY = "studioPrototype.editorLanguage";
const ANNOTATION_MODE_STORAGE_KEY = "studioPrototype.annotationsEnabled";
const EMPTY_OVERLAY_LINE = "\u200b";
const ANNOTATION_MARKER_REGEX = /\[an:\s*([^\]]+?)\]/gi;
const LANG_EXT_MAP = {
  markdown:   { label: "Markdown",   exts: ["md", "markdown", "mdx", "qmd"] },
  javascript: { label: "JavaScript", exts: ["js", "mjs", "cjs", "jsx"] },
  typescript: { label: "TypeScript", exts: ["ts", "mts", "cts", "tsx"] },
  python:     { label: "Python",     exts: ["py", "pyw"] },
  bash:       { label: "Bash",       exts: ["sh", "bash", "zsh"] },
  json:       { label: "JSON",       exts: ["json", "jsonc", "json5"] },
  rust:       { label: "Rust",       exts: ["rs"] },
  c:          { label: "C",          exts: ["c", "h"] },
  cpp:        { label: "C++",        exts: ["cpp", "cxx", "cc", "hpp", "hxx"] },
  julia:      { label: "Julia",      exts: ["jl"] },
  fortran:    { label: "Fortran",    exts: ["f90", "f95", "f03", "f", "for"] },
  r:          { label: "R",          exts: ["r"] },
  matlab:     { label: "MATLAB",     exts: ["m"] },
  latex:      { label: "LaTeX",      exts: ["tex", "latex"] },
  diff:       { label: "Diff",       exts: ["diff", "patch"] },
  html:       { label: "HTML",       exts: ["html", "htm"] },
  css:        { label: "CSS",        exts: ["css"] },
  xml:        { label: "XML",        exts: ["xml"] },
  yaml:       { label: "YAML",       exts: ["yaml", "yml"] },
  toml:       { label: "TOML",       exts: ["toml"] },
  lua:        { label: "Lua",        exts: ["lua"] },
  text:       { label: "Plain Text", exts: ["txt", "rst", "adoc"] },
};
const EXT_TO_LANG = {};
Object.keys(LANG_EXT_MAP).forEach((lang) => {
  LANG_EXT_MAP[lang].exts.forEach((ext) => {
    EXT_TO_LANG[ext.toLowerCase()] = lang;
  });
});
const HIGHLIGHTED_LANGUAGES = ["markdown", "javascript", "typescript", "python", "bash", "json", "rust", "c", "cpp", "julia", "fortran", "r", "matlab", "latex", "diff"];
const SUPPORTED_LANGUAGES = Object.keys(LANG_EXT_MAP).sort((a, b) => {
  const labelA = String(LANG_EXT_MAP[a]?.label || a);
  const labelB = String(LANG_EXT_MAP[b]?.label || b);
  return labelA.localeCompare(labelB);
});

const elements = {
  leftPane: document.getElementById("leftPane"),
  rightPane: document.getElementById("rightPane"),
  leftFocusBtn: document.getElementById("leftFocusBtn"),
  rightFocusBtn: document.getElementById("rightFocusBtn"),
  saveAsBtn: document.getElementById("saveAsBtn"),
  saveBtn: document.getElementById("saveBtn"),
  fileInput: document.getElementById("fileInput"),
  loadGitDiffBtn: document.getElementById("loadGitDiffBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  diagnosticsBtn: document.getElementById("diagnosticsBtn"),
  sourceBadge: document.getElementById("sourceBadge"),
  resourceDirBtn: document.getElementById("resourceDirBtn"),
  resourceDirLabel: document.getElementById("resourceDirLabel"),
  resourceDirInputWrap: document.getElementById("resourceDirInputWrap"),
  resourceDirInput: document.getElementById("resourceDirInput"),
  resourceDirClearBtn: document.getElementById("resourceDirClearBtn"),
  syncBadge: document.getElementById("syncBadge"),
  queueBadge: document.getElementById("queueBadge"),
  composerStatusBadge: document.getElementById("composerStatusBadge"),
  backendStatusBadge: document.getElementById("backendStatusBadge"),
  historyCountBadge: document.getElementById("historyCountBadge"),
  insertHeaderBtn: document.getElementById("insertHeaderBtn"),
  annotationModeSelect: document.getElementById("annotationModeSelect"),
  stripAnnotationsBtn: document.getElementById("stripAnnotationsBtn"),
  saveAnnotatedBtn: document.getElementById("saveAnnotatedBtn"),
  lensSelect: document.getElementById("lensSelect"),
  critiqueBtn: document.getElementById("critiqueBtn"),
  highlightSelect: document.getElementById("highlightSelect"),
  langSelect: document.getElementById("langSelect"),
  sourceHighlight: document.getElementById("sourceHighlight"),
  promptInput: document.getElementById("promptInput"),
  rightViewSelect: document.getElementById("rightViewSelect"),
  responseHighlightSelect: document.getElementById("responseHighlightSelect"),
  runBtn: document.getElementById("runBtn"),
  queueBtn: document.getElementById("queueBtn"),
  copyDraftBtn: document.getElementById("copyDraftBtn"),
  referenceBadge: document.getElementById("referenceBadge"),
  responseView: document.getElementById("responseView"),
  responseText: document.getElementById("responseText"),
  followSelect: document.getElementById("followSelect"),
  historyPrevBtn: document.getElementById("historyPrevBtn"),
  historyNextBtn: document.getElementById("historyNextBtn"),
  historyLastBtn: document.getElementById("historyLastBtn"),
  historyIndexBadge: document.getElementById("historyIndexBadge"),
  loadResponseBtn: document.getElementById("loadResponseBtn"),
  loadCritiqueNotesBtn: document.getElementById("loadCritiqueNotesBtn"),
  loadCritiqueFullBtn: document.getElementById("loadCritiqueFullBtn"),
  loadHistoryPromptBtn: document.getElementById("loadHistoryPromptBtn"),
  copyResponseBtn: document.getElementById("copyResponseBtn"),
  exportPdfBtn: document.getElementById("exportPdfBtn"),
  diagnosticsPanel: document.getElementById("diagnosticsPanel"),
  activeTurnPanel: document.getElementById("activeTurnPanel"),
  lastTurnPanel: document.getElementById("lastTurnPanel"),
  selectionPanel: document.getElementById("selectionPanel"),
  historyList: document.getElementById("historyList"),
  logSummary: document.getElementById("logSummary"),
  logOutput: document.getElementById("logOutput"),
  statusLine: document.getElementById("statusLine"),
  statusSpinner: document.getElementById("statusSpinner"),
  status: document.getElementById("status"),
  footerMeta: document.getElementById("footerMeta"),
  footerMetaText: document.getElementById("footerMetaText"),
};

function getStudioThemeInfo() {
  return BOOT_CONFIG && typeof BOOT_CONFIG.theme === "object" && BOOT_CONFIG.theme ? BOOT_CONFIG.theme : null;
}

function buildAuthenticatedPath(path) {
  const url = new URL(path, window.location.origin);
  if (STUDIO_ACCESS_TOKEN) {
    url.searchParams.set("token", STUDIO_ACCESS_TOKEN);
  }
  return `${url.pathname}${url.search}`;
}

function buildAuthenticatedHeaders(init = undefined) {
  const headers = new Headers(init || {});
  if (STUDIO_ACCESS_TOKEN) {
    headers.set("X-PI-STUDIO-TOKEN", STUDIO_ACCESS_TOKEN);
  }
  return headers;
}

function normalizedText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function getHistory() {
  return Array.isArray(state.snapshot?.history) ? state.snapshot.history : [];
}

function getLatestHistoryItem() {
  const history = getHistory();
  return history.length ? history.at(-1) : null;
}

function ensureSelectedHistoryItem() {
  const history = getHistory();
  if (!history.length) {
    state.selectedPromptId = null;
    return;
  }
  if (state.followLatest) {
    state.selectedPromptId = history.at(-1).localPromptId;
    return;
  }
  if (!history.some((item) => item.localPromptId === state.selectedPromptId)) {
    state.selectedPromptId = history.at(-1).localPromptId;
  }
}

function getSelectedHistoryItem() {
  ensureSelectedHistoryItem();
  const history = getHistory();
  if (!history.length) return null;
  return history.find((item) => item.localPromptId === state.selectedPromptId) || history.at(-1) || null;
}

function getSelectedHistoryIndex() {
  const history = getHistory();
  if (!history.length) return -1;
  return history.findIndex((item) => item.localPromptId === state.selectedPromptId);
}

function groupHistoryByChain(history) {
  const groups = new Map();
  for (const item of history) {
    const key = String(item.chainIndex);
    if (!groups.has(key)) {
      groups.set(key, { chainIndex: item.chainIndex, items: [] });
    }
    groups.get(key).items.push(item);
  }
  return Array.from(groups.values()).sort((a, b) => b.chainIndex - a.chainIndex);
}

function formatRelativeDuration(start, end) {
  if (!start || !end || end < start) return "-";
  const ms = end - start;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function formatAbsoluteTime(value) {
  return value ? new Date(value).toLocaleTimeString() : "-";
}

function formatReferenceTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatProviderLabel(providerID) {
  const raw = String(providerID || "").trim().toLowerCase();
  if (!raw) return "";
  const known = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    "github-copilot": "GitHub Copilot",
    opencode: "OpenCode",
    "opencode-go": "OpenCode Go",
    togetherai: "TogetherAI",
  };
  return known[raw] || providerID;
}

function formatModel(snapshot) {
  const model = snapshot?.currentModel;
  if (!model || !model.providerID || !model.modelID) return "-";
  return `${model.providerID}/${model.modelID}`;
}

function formatModelSummary(snapshot) {
  const model = snapshot?.currentModel;
  if (!model || !model.providerID || !model.modelID) return "Model: unknown";
  const parts = [model.modelID];
  const providerLabel = formatProviderLabel(model.providerID);
  if (providerLabel) parts.push(providerLabel);
  const variant = String(model.variant || "").trim();
  if (variant) parts.push(variant);
  return `Model: ${parts.join(" · ")}`;
}

function formatAgentLabel(snapshot) {
  const raw = String(snapshot?.currentModel?.agent || "").trim();
  if (!raw) return "";
  return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getTokenUsageTotal(snapshot) {
  return getTokenUsageTotalValue(snapshot?.currentModel?.tokenUsage);
}

function formatCompactTokenCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return "-";
  if (count < 1000) return `${Math.round(count)}`;
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

function formatContextUsage(snapshot) {
  const total = getTokenUsageTotal(snapshot);
  if (total == null) return "Context: unknown";
  const limit = snapshot?.currentModel?.contextLimit;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    const percent = Math.max(0, Math.round((total / limit) * 100));
    return `Context: ${formatCompactTokenCount(total)} / ${formatCompactTokenCount(limit)} (${percent}%)`;
  }
  return `Context: ${formatCompactTokenCount(total)} tokens`;
}

function formatSessionLabel(snapshot) {
  const sessionId = String(snapshot?.state?.sessionId || "").trim();
  const sessionTitle = String(snapshot?.state?.sessionTitle || "").trim();
  const useTitle = sessionTitle && !/^Studio host\b/i.test(sessionTitle) && sessionTitle !== "π Studio" && sessionTitle !== "Studio";
  if (useTitle && sessionId) {
    return `${sessionTitle} (${sessionId})`;
  }
  if (useTitle) {
    return sessionTitle;
  }
  return sessionId;
}

function formatProjectLabel(snapshot) {
  const directory = String(snapshot?.launchContext?.directory || "").trim();
  if (!directory) return "";
  const normalized = directory.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : normalized;
}

function cloneTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const clone = {};
  if (typeof usage.total === "number") clone.total = usage.total;
  if (typeof usage.input === "number") clone.input = usage.input;
  if (typeof usage.output === "number") clone.output = usage.output;
  if (typeof usage.reasoning === "number") clone.reasoning = usage.reasoning;
  return Object.keys(clone).length ? clone : undefined;
}

function cloneModelSnapshot(model) {
  if (!model || typeof model !== "object") return null;
  return {
    ...model,
    tokenUsage: cloneTokenUsage(model.tokenUsage),
  };
}

function getTokenUsageTotalValue(usage) {
  if (!usage || typeof usage !== "object") return null;
  if (typeof usage.total === "number" && Number.isFinite(usage.total) && usage.total >= 0) {
    return usage.total;
  }
  const parts = [usage.input, usage.output, usage.reasoning].filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (!parts.length) return null;
  return parts.reduce((sum, value) => sum + value, 0);
}

function hasMeaningfulTokenUsage(usage) {
  const total = getTokenUsageTotalValue(usage);
  return total != null && total > 0;
}

function modelSnapshotKey(model) {
  const providerID = String(model?.providerID || "").trim();
  const modelID = String(model?.modelID || "").trim();
  return providerID && modelID ? `${providerID}/${modelID}` : "";
}

function mergeSnapshotForDisplay(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;

  const stable = cloneModelSnapshot(state.stableCurrentModel);
  const incoming = cloneModelSnapshot(snapshot.currentModel);

  if (incoming) {
    const sameModel = Boolean(stable) && modelSnapshotKey(stable) === modelSnapshotKey(incoming);
    if (sameModel) {
      incoming.agent = incoming.agent || stable.agent;
      incoming.variant = incoming.variant || stable.variant;
      incoming.contextLimit = incoming.contextLimit || stable.contextLimit;

      const running = snapshot?.state?.runState === "running" || snapshot?.state?.runState === "stopping";
      const incomingTotal = getTokenUsageTotalValue(incoming.tokenUsage);
      const stableTotal = getTokenUsageTotalValue(stable.tokenUsage);
      const shouldKeepStableUsage = running
        ? (hasMeaningfulTokenUsage(stable.tokenUsage) && (incomingTotal == null || incomingTotal <= 0 || incomingTotal < stableTotal))
        : !hasMeaningfulTokenUsage(incoming.tokenUsage);

      if (shouldKeepStableUsage) {
        incoming.tokenUsage = stable.tokenUsage;
      }
    }
    snapshot.currentModel = incoming;
    state.stableCurrentModel = cloneModelSnapshot(incoming);
    return snapshot;
  }

  if (stable) {
    snapshot.currentModel = stable;
  }
  return snapshot;
}

function buildBaseDocumentTitle() {
  const projectLabel = formatProjectLabel(state.snapshot);
  return projectLabel
    ? `πₒ Studio · ${projectLabel}`
    : "πₒ Studio · OpenCode";
}

function shouldShowTitleAttention() {
  const focused = typeof document !== "undefined" && typeof document.hasFocus === "function"
    ? document.hasFocus()
    : state.windowHasFocus;
  return Boolean(typeof document !== "undefined" && document.hidden) || !focused;
}

function getComputedDocumentTitle() {
  const baseTitle = buildBaseDocumentTitle();
  return state.titleAttentionMessage
    ? `${state.titleAttentionMessage} · ${baseTitle}`
    : baseTitle;
}

function stopTitleAttentionTimer() {
  if (!state.titleAttentionTimer) return;
  window.clearInterval(state.titleAttentionTimer);
  state.titleAttentionTimer = null;
}

function syncTitleAttentionTimer() {
  if (!state.titleAttentionMessage || !shouldShowTitleAttention()) {
    stopTitleAttentionTimer();
    return;
  }
  if (state.titleAttentionTimer) return;
  state.titleAttentionTimer = window.setInterval(() => {
    if (!state.titleAttentionMessage || !shouldShowTitleAttention()) {
      stopTitleAttentionTimer();
      return;
    }
    const title = getComputedDocumentTitle();
    if (document.title !== title) {
      document.title = title;
    }
    state.lastAppliedDocumentTitle = title;
  }, 1500);
}

function updateDocumentTitle(force = false) {
  const title = getComputedDocumentTitle();
  if (force || state.lastAppliedDocumentTitle !== title) {
    document.title = title;
    state.lastAppliedDocumentTitle = title;
  }
  syncTitleAttentionTimer();
}

function clearTitleAttention() {
  if (!state.titleAttentionMessage) {
    stopTitleAttentionTimer();
    updateDocumentTitle();
    return;
  }
  state.titleAttentionMessage = "";
  stopTitleAttentionTimer();
  updateDocumentTitle(true);
}

function armTitleAttention(message) {
  const nextMessage = String(message || "").trim();
  if (!nextMessage) return;
  state.titleAttentionMessage = nextMessage;
  updateDocumentTitle(true);
}

function getCompletedTurnKey(turn) {
  if (!turn) return "";
  const localPromptId = String(turn.localPromptId || "").trim();
  const completedAt = typeof turn.completedAt === "number" && Number.isFinite(turn.completedAt)
    ? turn.completedAt
    : 0;
  if (localPromptId && completedAt > 0) return `${localPromptId}:${completedAt}`;
  if (localPromptId) return localPromptId;
  if (completedAt > 0) return `completed:${completedAt}`;
  return "";
}

function maybeArmCompletionTitleAttention(snapshot, { initial = false } = {}) {
  const nextKey = getCompletedTurnKey(snapshot?.lastCompletedTurn);
  if (initial || !state.initialSnapshotLoaded) {
    state.initialSnapshotLoaded = true;
    state.lastCompletedTurnKey = nextKey;
    return;
  }

  if (!nextKey || nextKey === state.lastCompletedTurnKey) {
    state.lastCompletedTurnKey = nextKey;
    return;
  }

  state.lastCompletedTurnKey = nextKey;
  if (!shouldShowTitleAttention()) return;
  armTitleAttention(getRequestKind(snapshot?.lastCompletedTurn) === "critique" ? "● Critique ready" : "● Response ready");
}

function applySnapshot(snapshot, options = {}) {
  state.snapshot = mergeSnapshotForDisplay(snapshot);
  maybeArmCompletionTitleAttention(state.snapshot, options);
}

function getRequestKind(value) {
  if (value && value.requestKind === "critique") return "critique";
  if (value && value.promptMode === "response") return "response";
  return "run";
}

function isCritiqueResponseMarkdown(markdown) {
  const lower = String(markdown || "").toLowerCase();
  return lower.includes("## critiques") && lower.includes("## document");
}

function isCritiqueHistoryItem(item) {
  return Boolean(item) && (getRequestKind(item) === "critique" || isCritiqueResponseMarkdown(item.responseText || ""));
}

function isCritiqueDisplay(display) {
  if (!display) return false;
  if (display.kind === "history") {
    return isCritiqueHistoryItem(display.item);
  }
  if (display.kind === "active") {
    return getRequestKind(display.turn) === "critique";
  }
  return false;
}

function extractMarkdownSection(markdown, title) {
  const heading = `## ${String(title || "").trim().toLowerCase()}`;
  const lines = String(markdown || "").split("\n");
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    if (String(lines[i] || "").trim().toLowerCase() === heading) {
      start = i + 1;
      break;
    }
  }

  if (start < 0) return "";

  const collected = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (String(line || "").trim().startsWith("## ")) break;
    collected.push(line);
  }

  return collected.join("\n").trim();
}

function buildCritiqueNotesMarkdown(markdown) {
  const assessment = extractMarkdownSection(markdown, "Assessment");
  const critiques = extractMarkdownSection(markdown, "Critiques");
  const parts = [];

  if (assessment) {
    parts.push(`## Assessment\n\n${assessment}`);
  }
  if (critiques) {
    parts.push(`## Critiques\n\n${critiques}`);
  }

  return parts.join("\n\n").trim();
}

function getHistoryPromptButtonLabel(item) {
  if (!item) return "Load response prompt into editor";
  if (item.promptMode === "steer") return "Load effective prompt into editor";
  if (item.promptMode === "run" && getRequestKind(item) === "critique") return "Load critique prompt into editor";
  if (item.promptMode === "run") return "Load run prompt into editor";
  return "Load response prompt into editor";
}

function getHistoryPromptLoadedStatus(item) {
  if (!item) return "Prompt unavailable for the selected response.";
  if (item.promptMode === "steer") return "Loaded effective prompt into editor.";
  if (item.promptMode === "run" && getRequestKind(item) === "critique") return "Loaded critique prompt into editor.";
  if (item.promptMode === "run") return "Loaded run prompt into editor.";
  return "Loaded response prompt into editor.";
}

function getHistoryPromptSourceStateLabel(item) {
  if (!item) return "response prompt";
  if (item.promptMode === "steer") return "effective prompt";
  if (item.promptMode === "run" && getRequestKind(item) === "critique") return "critique prompt";
  if (item.promptMode === "run") return "run prompt";
  return "response prompt";
}

function getHistoryItemTitle(item) {
  if (!item) return "Response";
  if (item.promptMode === "run" && getRequestKind(item) === "critique") return "Critique";
  if (item.promptMode === "run") return "Run";
  if (item.promptMode === "steer") return `Steer ${item.promptSteeringCount}`;
  return "Response";
}

function readStoredToggle(storageKey) {
  if (!window.localStorage) return null;
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "on") return true;
    if (value === "off") return false;
    return null;
  } catch {
    return null;
  }
}

function persistStoredToggle(storageKey, enabled) {
  if (!window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, enabled ? "on" : "off");
  } catch {}
}

function readStoredEditorLanguage() {
  if (!window.localStorage) return null;
  try {
    const value = window.localStorage.getItem(EDITOR_LANGUAGE_STORAGE_KEY);
    if (value && SUPPORTED_LANGUAGES.includes(value)) return value;
    return null;
  } catch {
    return null;
  }
}

function persistEditorLanguage(lang) {
  if (!window.localStorage) return;
  try {
    window.localStorage.setItem(EDITOR_LANGUAGE_STORAGE_KEY, lang || "markdown");
  } catch {}
}

function preferredExtensionForLanguage(lang) {
  const entry = LANG_EXT_MAP[lang];
  return entry && entry.exts && entry.exts.length ? entry.exts[0] : "md";
}

function populateLanguageOptions() {
  if (!elements.langSelect || elements.langSelect.options.length > 0) return;
  for (const lang of SUPPORTED_LANGUAGES) {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = `Lang: ${LANG_EXT_MAP[lang].label}`;
    elements.langSelect.appendChild(option);
  }
}

function normalizeFenceLanguage(info) {
  const raw = String(info || "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0].replace(/^\./, "").toLowerCase();
  if (first === "js" || first === "javascript" || first === "jsx" || first === "node") return "javascript";
  if (first === "ts" || first === "typescript" || first === "tsx") return "typescript";
  if (first === "py" || first === "python") return "python";
  if (first === "sh" || first === "bash" || first === "zsh" || first === "shell") return "bash";
  if (first === "json" || first === "jsonc") return "json";
  if (first === "rust" || first === "rs") return "rust";
  if (first === "c" || first === "h") return "c";
  if (first === "cpp" || first === "c++" || first === "cxx" || first === "hpp") return "cpp";
  if (first === "julia" || first === "jl") return "julia";
  if (first === "fortran" || first === "f90" || first === "f95" || first === "f03" || first === "f" || first === "for") return "fortran";
  if (first === "r") return "r";
  if (first === "matlab" || first === "m") return "matlab";
  if (first === "latex" || first === "tex") return "latex";
  if (first === "diff" || first === "patch" || first === "udiff") return "diff";
  return EXT_TO_LANG[first] || "";
}

function detectLanguageFromName(name) {
  if (!name) return "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return EXT_TO_LANG[name.slice(dot + 1).toLowerCase()] || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHighlight(className, text) {
  return `<span class="${className}">${escapeHtml(String(text || ""))}</span>`;
}

function highlightInlineAnnotations(text) {
  const source = String(text || "");
  ANNOTATION_MARKER_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let out = "";
  let match;
  while ((match = ANNOTATION_MARKER_REGEX.exec(source)) !== null) {
    const token = match[0] || "";
    const start = typeof match.index === "number" ? match.index : 0;
    if (start > lastIndex) {
      out += escapeHtml(source.slice(lastIndex, start));
    }
    out += wrapHighlight(state.annotationsEnabled ? "hl-annotation" : "hl-annotation-muted", token);
    lastIndex = start + token.length;
    if (token.length === 0) ANNOTATION_MARKER_REGEX.lastIndex += 1;
  }
  ANNOTATION_MARKER_REGEX.lastIndex = 0;
  if (lastIndex < source.length) {
    out += escapeHtml(source.slice(lastIndex));
  }
  return out;
}

function highlightInlineMarkdown(text) {
  const source = String(text || "");
  const pattern = /(\x60[^\x60]*\x60)|(\[[^\]]+\]\([^)]+\))|(\[an:\s*[^\]]+\])/gi;
  let lastIndex = 0;
  let out = "";
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const token = match[0] || "";
    const start = typeof match.index === "number" ? match.index : 0;
    if (start > lastIndex) {
      out += escapeHtml(source.slice(lastIndex, start));
    }
    if (match[1]) {
      out += wrapHighlight("hl-code", token);
    } else if (match[2]) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        out += wrapHighlight("hl-link", `[${linkMatch[1]}]`);
        out += `(${wrapHighlight("hl-url", linkMatch[2])})`;
      } else {
        out += escapeHtml(token);
      }
    } else if (match[3]) {
      out += highlightInlineAnnotations(token);
    } else {
      out += escapeHtml(token);
    }
    lastIndex = start + token.length;
  }
  if (lastIndex < source.length) {
    out += escapeHtml(source.slice(lastIndex));
  }
  return out;
}

function highlightCodeTokens(line, pattern, classifyMatch) {
  const source = String(line || "");
  let out = "";
  let lastIndex = 0;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const token = match[0] || "";
    const start = typeof match.index === "number" ? match.index : 0;
    if (start > lastIndex) {
      out += escapeHtml(source.slice(lastIndex, start));
    }
    out += wrapHighlight(classifyMatch(match) || "hl-code", token);
    lastIndex = start + token.length;
    if (token.length === 0) pattern.lastIndex += 1;
  }
  if (lastIndex < source.length) {
    out += escapeHtml(source.slice(lastIndex));
  }
  return out;
}

function highlightCodeLine(line, language) {
  const source = String(line || "");
  const lang = normalizeFenceLanguage(language);
  if (!lang) return wrapHighlight("hl-code", source);

  if (lang === "javascript" || lang === "typescript") {
    const pattern = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|class|extends|import|from|export|default|async|await|true|false|null|undefined|typeof|instanceof)\b)|(\b\d+(?:\.\d+)?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "python") {
    const pattern = /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:def|class|return|if|elif|else|for|while|try|except|finally|import|from|as|with|lambda|yield|True|False|None|and|or|not|in|is|pass|break|continue|raise|global|nonlocal|assert)\b)|(\b\d+(?:\.\d+)?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "bash") {
    const pattern = /(#.*$)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)|(\b(?:if|then|else|fi|for|in|do|done|case|esac|function|local|export|readonly|return|break|continue|while|until)\b)|(\b\d+\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-var" : m[4] ? "hl-code-kw" : m[5] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "json") {
    const pattern = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\b(?:true|false|null)\b)|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-key" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "rust") {
    const pattern = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(\b(?:fn|let|mut|const|struct|enum|impl|trait|pub|mod|use|crate|self|super|match|if|else|for|while|loop|return|break|continue|where|as|in|ref|move|async|await|unsafe|extern|type|static|true|false|Some|None|Ok|Err|Self)\b)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:f32|f64|u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "c" || lang === "cpp") {
    const pattern = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(#\s*\w+)|(\b(?:if|else|for|while|do|switch|case|break|continue|return|goto|struct|union|enum|typedef|sizeof|void|int|char|short|long|float|double|unsigned|signed|const|static|extern|volatile|register|inline|auto|restrict|true|false|NULL|nullptr|class|public|private|protected|virtual|override|template|typename|namespace|using|new|delete|try|catch|throw|noexcept|constexpr|decltype|static_cast|dynamic_cast|reinterpret_cast|const_cast|std|include|define|ifdef|ifndef|endif|pragma)\b)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFlLuU]*\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] || m[4] ? "hl-code-kw" : m[5] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "julia") {
    const pattern = /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:function|end|if|elseif|else|for|while|begin|let|local|global|const|return|break|continue|do|try|catch|finally|throw|module|import|using|export|struct|mutable|abstract|primitive|where|macro|quote|true|false|nothing|missing|in|isa|typeof)\b)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "fortran") {
    const pattern = /(!.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:program|end|subroutine|function|module|use|implicit|none|integer|real|double|precision|complex|character|logical|dimension|allocatable|intent|in|out|inout|parameter|data|do|if|then|else|elseif|endif|enddo|call|return|write|read|print|format|stop|contains|type|class|select|case|where|forall|associate|block|procedure|interface|abstract|extends|allocate|deallocate|cycle|exit|go|to|common|equivalence|save|external|intrinsic)\b)|(\b\d+(?:\.\d+)?(?:[dDeE][+-]?\d+)?\b)/gi;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "r") {
    const pattern = /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:function|if|else|for|while|repeat|in|next|break|return|TRUE|FALSE|NULL|NA|NA_integer_|NA_real_|NA_complex_|NA_character_|Inf|NaN|library|require|source|local|switch)\b)|(<-|->|<<-|->>)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[Li]?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] || m[4] ? "hl-code-kw" : m[5] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "matlab") {
    const pattern = /(%.*$)|('(?:[^']|'')*'|"(?:[^"\\]|\\.)*")|(\b(?:function|end|if|elseif|else|for|while|switch|case|otherwise|try|catch|return|break|continue|global|persistent|classdef|properties|methods|events|enumeration|true|false)\b)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[i]?\b)/g;
    return `<span class="hl-code">${highlightCodeTokens(source, pattern, (m) => m[1] ? "hl-code-com" : m[2] ? "hl-code-str" : m[3] ? "hl-code-kw" : m[4] ? "hl-code-num" : "hl-code")}</span>`;
  }

  if (lang === "latex") {
    const pattern = /(%.*$)|(\[an:\s*[^\]]+\])|(\\(?:documentclass|usepackage|newtheorem|begin|end|section|subsection|subsubsection|chapter|part|title|author|date|maketitle|tableofcontents|includegraphics|caption|label|ref|eqref|cite|textbf|textit|texttt|emph|footnote|centering|newcommand|renewcommand|providecommand|bibliography|bibliographystyle|bibitem|item|input|include)\b)|(\\[A-Za-z]+)|(\{|\})|(\$\$?(?:[^$\\]|\\.)+\$\$?)|(\[(?:.*?)\])/gi;
    let out = "";
    let lastIndex = 0;
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(source)) !== null) {
      const token = match[0] || "";
      const start = typeof match.index === "number" ? match.index : 0;
      if (start > lastIndex) out += escapeHtml(source.slice(lastIndex, start));
      if (match[1]) out += wrapHighlight("hl-code-com", token);
      else if (match[2]) out += highlightInlineAnnotations(token);
      else if (match[3]) out += wrapHighlight("hl-code-kw", token);
      else if (match[4]) out += wrapHighlight("hl-code-fn", token);
      else if (match[5]) out += wrapHighlight("hl-code-op", token);
      else if (match[6]) out += wrapHighlight("hl-code-str", token);
      else if (match[7]) out += wrapHighlight("hl-code-num", token);
      else out += escapeHtml(token);
      lastIndex = start + token.length;
      if (token.length === 0) pattern.lastIndex += 1;
    }
    if (lastIndex < source.length) out += escapeHtml(source.slice(lastIndex));
    return out;
  }

  if (lang === "diff") {
    const highlightedDiff = highlightInlineAnnotations(source);
    if (/^@@/.test(source)) return `<span class="hl-code-fn">${highlightedDiff}</span>`;
    if (/^\+\+\+|^---/.test(source)) return `<span class="hl-code-kw">${highlightedDiff}</span>`;
    if (/^\+/.test(source)) return `<span class="hl-diff-add">${highlightedDiff}</span>`;
    if (/^-/.test(source)) return `<span class="hl-diff-del">${highlightedDiff}</span>`;
    if (/^diff /.test(source)) return `<span class="hl-code-kw">${highlightedDiff}</span>`;
    if (/^index /.test(source)) return `<span class="hl-code-com">${highlightedDiff}</span>`;
    return highlightedDiff;
  }

  return wrapHighlight("hl-code", source);
}

function highlightMarkdown(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inFence = false;
  let fenceChar = null;
  let fenceLength = 0;
  let fenceLanguage = "";

  for (const line of lines) {
    const fenceMatch = line.match(/^(\s*)([`]{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[2] || "";
      const markerChar = marker.charAt(0);
      const markerLength = marker.length;
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
        fenceLength = markerLength;
        fenceLanguage = normalizeFenceLanguage(fenceMatch[3] || "");
      } else if (fenceChar === markerChar && markerLength >= fenceLength) {
        inFence = false;
        fenceChar = null;
        fenceLength = 0;
        fenceLanguage = "";
      }
      out.push(wrapHighlight("hl-fence", line));
      continue;
    }

    if (inFence) {
      out.push(line.length > 0 ? highlightCodeLine(line, fenceLanguage) : EMPTY_OVERLAY_LINE);
      continue;
    }

    if (line.length === 0) {
      out.push(EMPTY_OVERLAY_LINE);
      continue;
    }

    const headingMatch = line.match(/^(\s{0,3})(#{1,6}\s+)(.*)$/);
    if (headingMatch) {
      out.push(escapeHtml(headingMatch[1] || "") + wrapHighlight("hl-heading", (headingMatch[2] || "") + (headingMatch[3] || "")));
      continue;
    }

    const quoteMatch = line.match(/^(\s{0,3}>\s?)(.*)$/);
    if (quoteMatch) {
      out.push(wrapHighlight("hl-quote", quoteMatch[1] || "") + highlightInlineMarkdown(quoteMatch[2] || ""));
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/);
    if (listMatch) {
      out.push(
        escapeHtml(listMatch[1] || "")
          + wrapHighlight("hl-list", listMatch[2] || "")
          + escapeHtml(listMatch[3] || "")
          + highlightInlineMarkdown(listMatch[4] || ""),
      );
      continue;
    }

    out.push(highlightInlineMarkdown(line));
  }

  return out.join("<br>");
}

function highlightCode(text, language) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const lang = normalizeFenceLanguage(language);
  const out = [];
  for (const line of lines) {
    if (line.length === 0) out.push(EMPTY_OVERLAY_LINE);
    else if (lang) out.push(highlightCodeLine(line, lang));
    else out.push(escapeHtml(line));
  }
  return out.join("<br>");
}

function syncEditorHighlightScroll() {
  if (!elements.sourceHighlight) return;
  elements.sourceHighlight.scrollTop = elements.promptInput.scrollTop;
  elements.sourceHighlight.scrollLeft = elements.promptInput.scrollLeft;
}

function renderEditorHighlightNow() {
  if (!elements.sourceHighlight) return;
  if (!state.editorHighlightEnabled) {
    elements.sourceHighlight.innerHTML = "";
    return;
  }
  const text = elements.promptInput.value || "";
  if (text.length > EDITOR_HIGHLIGHT_MAX_CHARS) {
    elements.sourceHighlight.textContent = text;
    syncEditorHighlightScroll();
    return;
  }
  elements.sourceHighlight.innerHTML = state.editorLanguage === "markdown"
    ? highlightMarkdown(text)
    : highlightCode(text, state.editorLanguage);
  syncEditorHighlightScroll();
}

function scheduleEditorHighlightRender() {
  if (state.editorHighlightRenderRaf !== null) {
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(state.editorHighlightRenderRaf);
    } else {
      window.clearTimeout(state.editorHighlightRenderRaf);
    }
    state.editorHighlightRenderRaf = null;
  }
  const schedule = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (cb) => window.setTimeout(cb, 16);
  state.editorHighlightRenderRaf = schedule(() => {
    state.editorHighlightRenderRaf = null;
    renderEditorHighlightNow();
  });
}

function setEditorHighlightEnabled(enabled) {
  state.editorHighlightEnabled = Boolean(enabled);
  persistStoredToggle(EDITOR_HIGHLIGHT_STORAGE_KEY, state.editorHighlightEnabled);
  if (elements.highlightSelect) {
    elements.highlightSelect.value = state.editorHighlightEnabled ? "on" : "off";
  }
  if (elements.sourceHighlight) {
    elements.sourceHighlight.hidden = !state.editorHighlightEnabled;
  }
  elements.promptInput.classList.toggle("highlight-active", state.editorHighlightEnabled);
  if (state.editorHighlightEnabled) {
    scheduleEditorHighlightRender();
  } else if (elements.sourceHighlight) {
    elements.sourceHighlight.innerHTML = "";
    elements.sourceHighlight.scrollTop = 0;
    elements.sourceHighlight.scrollLeft = 0;
  }
}

function setEditorLanguage(lang) {
  state.editorLanguage = SUPPORTED_LANGUAGES.includes(lang) ? lang : "markdown";
  persistEditorLanguage(state.editorLanguage);
  if (elements.langSelect) {
    elements.langSelect.value = state.editorLanguage;
  }
  if (state.editorHighlightEnabled) {
    scheduleEditorHighlightRender();
  }
}

function setResponseHighlightEnabled(enabled) {
  state.responseHighlightEnabled = Boolean(enabled);
  persistStoredToggle(RESPONSE_HIGHLIGHT_STORAGE_KEY, state.responseHighlightEnabled);
  if (elements.responseHighlightSelect) {
    elements.responseHighlightSelect.value = state.responseHighlightEnabled ? "on" : "off";
  }
}

function setAnnotationsEnabled(enabled) {
  state.annotationsEnabled = Boolean(enabled);
  persistStoredToggle(ANNOTATION_MODE_STORAGE_KEY, state.annotationsEnabled);
  if (elements.annotationModeSelect) {
    elements.annotationModeSelect.value = state.annotationsEnabled ? "on" : "off";
  }
  if (state.editorHighlightEnabled) {
    scheduleEditorHighlightRender();
  }
  state.currentRenderedPreviewKey = "";
}

function buildPlainMarkdownHtml(markdown) {
  return `<pre class="plain-markdown">${escapeHtml(String(markdown || ""))}</pre>`;
}

function buildPreviewErrorHtml(message, markdown) {
  return `<div class="preview-error">${escapeHtml(String(message || "Preview rendering failed."))}</div>${buildPlainMarkdownHtml(markdown)}`;
}

function sanitizeRenderedHtml(html, markdown) {
  const rawHtml = typeof html === "string" ? html : "";
  const mathAnnotationStripped = rawHtml
    .replace(/<annotation-xml\b[\s\S]*?<\/annotation-xml>/gi, "")
    .replace(/<annotation\b[\s\S]*?<\/annotation>/gi, "");

  if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
    return window.DOMPurify.sanitize(mathAnnotationStripped, {
      USE_PROFILES: {
        html: true,
        mathMl: true,
        svg: true,
      },
      ADD_TAGS: ["embed"],
      ADD_ATTR: ["src", "type", "title", "width", "height", "style", "data-fig-align"],
      ADD_DATA_URI_TAGS: ["embed"],
    });
  }

  return buildPreviewErrorHtml("Preview sanitizer unavailable. Showing plain markdown.", markdown);
}

function isPdfPreviewSource(src) {
  return Boolean(src) && (/^data:application\/pdf(?:;|,)/i.test(src) || /\.pdf(?:$|[?#])/i.test(src));
}

function decoratePdfEmbeds(targetEl) {
  if (!targetEl || typeof targetEl.querySelectorAll !== "function") {
    return;
  }

  const embeds = targetEl.querySelectorAll("embed[src]");
  embeds.forEach((embedEl) => {
    const src = typeof embedEl.getAttribute === "function" ? (embedEl.getAttribute("src") || "") : "";
    if (!isPdfPreviewSource(src)) {
      return;
    }
    if (!embedEl.getAttribute("type")) {
      embedEl.setAttribute("type", "application/pdf");
    }
    if (!embedEl.getAttribute("title")) {
      embedEl.setAttribute("title", "Embedded PDF figure");
    }
  });
}

function decodePdfDataUri(src) {
  const match = String(src || "").match(/^data:application\/pdf(?:;[^,]*)?,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const payload = (match[1] || "").replace(/\s+/g, "");
  if (!payload) return null;
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function ensurePdfJs() {
  if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === "function") {
    return Promise.resolve(window.pdfjsLib);
  }
  if (pdfJsPromise) {
    return pdfJsPromise;
  }

  pdfJsPromise = import(PDFJS_CDN_URL)
    .then((module) => {
      const api = module && typeof module.getDocument === "function"
        ? module
        : (module && module.default && typeof module.default.getDocument === "function" ? module.default : null);
      if (!api || typeof api.getDocument !== "function") {
        throw new Error("pdf.js did not initialize.");
      }
      if (api.GlobalWorkerOptions && !api.GlobalWorkerOptions.workerSrc) {
        api.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
      }
      window.pdfjsLib = api;
      return api;
    })
    .catch((error) => {
      pdfJsPromise = null;
      throw error;
    });

  return pdfJsPromise;
}

function appendPdfPreviewNotice(targetEl, message) {
  if (!targetEl || typeof targetEl.querySelector !== "function" || typeof targetEl.appendChild !== "function") {
    return;
  }
  if (targetEl.querySelector(".preview-pdf-warning")) {
    return;
  }
  const warningEl = document.createElement("div");
  warningEl.className = "preview-warning preview-pdf-warning";
  warningEl.textContent = String(message || PDF_PREVIEW_UNAVAILABLE_MESSAGE);
  targetEl.appendChild(warningEl);
}

async function loadPdfDocumentSource(src) {
  const embedded = decodePdfDataUri(src);
  if (embedded) {
    return { data: embedded };
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error("Failed to fetch PDF figure for preview.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { data: bytes };
}

async function renderSinglePdfPreviewEmbed(embedEl, pdfjsLib) {
  if (!embedEl || embedEl.dataset.studioPdfPreviewRendered === "1") {
    return false;
  }

  const src = embedEl.getAttribute("src") || "";
  if (!isPdfPreviewSource(src)) {
    return false;
  }

  const measuredWidth = Math.max(1, Math.round(embedEl.getBoundingClientRect().width || 0));
  const styleText = embedEl.getAttribute("style") || "";
  const widthAttr = embedEl.getAttribute("width") || "";
  const figAlign = embedEl.getAttribute("data-fig-align") || "";
  const pdfSource = await loadPdfDocumentSource(src);
  const loadingTask = pdfjsLib.getDocument(pdfSource);
  const pdfDocument = await loadingTask.promise;

  try {
    const page = await pdfDocument.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const cssWidth = Math.max(1, measuredWidth || Math.round(baseViewport.width));
    const renderScale = Math.max(0.25, cssWidth / baseViewport.width) * Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Canvas 2D context unavailable.");
    }

    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.setAttribute("aria-label", "PDF figure preview");

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const wrapper = document.createElement("div");
    wrapper.className = "studio-pdf-preview";
    if (styleText) {
      wrapper.style.cssText = styleText;
    } else if (widthAttr) {
      wrapper.style.width = /^\d+(?:\.\d+)?$/.test(widthAttr) ? (widthAttr + "px") : widthAttr;
    } else {
      wrapper.style.width = "100%";
    }
    if (figAlign) {
      wrapper.setAttribute("data-fig-align", figAlign);
    }
    wrapper.title = "PDF figure preview (page 1)";
    wrapper.appendChild(canvas);
    embedEl.dataset.studioPdfPreviewRendered = "1";
    embedEl.replaceWith(wrapper);
    return true;
  } finally {
    if (typeof pdfDocument.cleanup === "function") {
      try { pdfDocument.cleanup(); } catch {}
    }
    if (typeof pdfDocument.destroy === "function") {
      try { await pdfDocument.destroy(); } catch {}
    }
  }
}

async function renderPdfPreviewsInElement(targetEl) {
  if (!targetEl || typeof targetEl.querySelectorAll !== "function") {
    return;
  }

  const embeds = Array.from(targetEl.querySelectorAll("embed[src]"))
    .filter((embedEl) => isPdfPreviewSource(embedEl.getAttribute("src") || ""));
  if (embeds.length === 0) {
    return;
  }

  let pdfjsLib;
  try {
    pdfjsLib = await ensurePdfJs();
  } catch (error) {
    console.error("pdf.js load failed:", error);
    appendPdfPreviewNotice(targetEl, PDF_PREVIEW_UNAVAILABLE_MESSAGE);
    return;
  }

  let hadFailure = false;
  for (const embedEl of embeds) {
    try {
      await renderSinglePdfPreviewEmbed(embedEl, pdfjsLib);
    } catch (error) {
      hadFailure = true;
      console.error("PDF preview render failed:", error);
    }
  }

  if (hadFailure) {
    appendPdfPreviewNotice(targetEl, PDF_PREVIEW_RENDER_FAIL_MESSAGE);
  }
}

function applyAnnotationMarkersToElement(targetEl, mode) {
  if (!targetEl || mode === "none") return;
  if (typeof document.createTreeWalker !== "function") return;

  const walker = document.createTreeWalker(targetEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node = walker.nextNode();
  while (node) {
    const textNode = node;
    const value = typeof textNode.nodeValue === "string" ? textNode.nodeValue : "";
    if (value && value.toLowerCase().includes("[an:")) {
      const parent = textNode.parentElement;
      const tag = parent && parent.tagName ? parent.tagName.toUpperCase() : "";
      if (!["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA"].includes(tag)) {
        textNodes.push(textNode);
      }
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = typeof textNode.nodeValue === "string" ? textNode.nodeValue : "";
    if (!text) continue;
    ANNOTATION_MARKER_REGEX.lastIndex = 0;
    if (!ANNOTATION_MARKER_REGEX.test(text)) continue;
    ANNOTATION_MARKER_REGEX.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = ANNOTATION_MARKER_REGEX.exec(text)) !== null) {
      const token = match[0] || "";
      const start = typeof match.index === "number" ? match.index : 0;
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      if (mode === "highlight") {
        const markerEl = document.createElement("span");
        markerEl.className = "annotation-preview-marker";
        markerEl.textContent = typeof match[1] === "string" ? match[1].trim() : token;
        markerEl.title = token;
        fragment.appendChild(markerEl);
      }
      lastIndex = start + token.length;
      if (token.length === 0) ANNOTATION_MARKER_REGEX.lastIndex += 1;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }
}

function appendMathFallbackNotice(targetEl, message) {
  if (!targetEl || typeof targetEl.querySelector !== "function" || typeof targetEl.appendChild !== "function") {
    return;
  }

  if (targetEl.querySelector(".preview-math-warning")) {
    return;
  }

  const warningEl = document.createElement("div");
  warningEl.className = "preview-warning preview-math-warning";
  warningEl.textContent = String(message || MATHJAX_UNAVAILABLE_MESSAGE);
  targetEl.appendChild(warningEl);
}

function extractMathFallbackTex(text, displayMode) {
  const source = typeof text === "string" ? text.trim() : "";
  if (!source) return "";

  if (displayMode) {
    if (source.startsWith("$$") && source.endsWith("$$") && source.length >= 4) {
      return source.slice(2, -2).replace(/^\s+|\s+$/g, "");
    }
    if (source.startsWith("\\[") && source.endsWith("\\]") && source.length >= 4) {
      return source.slice(2, -2).replace(/^\s+|\s+$/g, "");
    }
    return source;
  }

  if (source.startsWith("\\(") && source.endsWith("\\)") && source.length >= 4) {
    return source.slice(2, -2).trim();
  }
  if (source.startsWith("$") && source.endsWith("$") && source.length >= 2) {
    return source.slice(1, -1).trim();
  }
  return source;
}

function collectMathFallbackTargets(targetEl) {
  if (!targetEl || typeof targetEl.querySelectorAll !== "function") return [];

  const nodes = Array.from(targetEl.querySelectorAll(".math.display, .math.inline"));
  const targets = [];
  const seenTargets = new Set();

  nodes.forEach((node) => {
    if (!node || !node.classList) return;
    const displayMode = node.classList.contains("display");
    const rawText = typeof node.textContent === "string" ? node.textContent : "";
    const tex = extractMathFallbackTex(rawText, displayMode);
    if (!tex) return;

    let renderTarget = node;
    if (displayMode) {
      const parent = node.parentElement;
      const parentText = parent && typeof parent.textContent === "string" ? parent.textContent.trim() : "";
      if (parent && parent.tagName === "P" && parentText === rawText.trim()) {
        renderTarget = parent;
      }
    }

    if (seenTargets.has(renderTarget)) return;
    seenTargets.add(renderTarget);
    targets.push({ node, renderTarget, displayMode, tex });
  });

  return targets;
}

function ensureMathJax() {
  if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
    return Promise.resolve(window.MathJax);
  }

  if (mathJaxPromise) {
    return mathJaxPromise;
  }

  mathJaxPromise = new Promise((resolve, reject) => {
    const globalMathJax = (window.MathJax && typeof window.MathJax === "object") ? window.MathJax : {};
    const texConfig = (globalMathJax.tex && typeof globalMathJax.tex === "object") ? globalMathJax.tex : {};
    const loaderConfig = (globalMathJax.loader && typeof globalMathJax.loader === "object") ? globalMathJax.loader : {};
    const startupConfig = (globalMathJax.startup && typeof globalMathJax.startup === "object") ? globalMathJax.startup : {};
    const optionsConfig = (globalMathJax.options && typeof globalMathJax.options === "object") ? globalMathJax.options : {};
    const loaderEntries = Array.isArray(loaderConfig.load) ? loaderConfig.load.slice() : [];
    ["[tex]/ams", "[tex]/noerrors", "[tex]/noundefined"].forEach((entry) => {
      if (loaderEntries.indexOf(entry) === -1) loaderEntries.push(entry);
    });

    window.MathJax = Object.assign({}, globalMathJax, {
      loader: Object.assign({}, loaderConfig, {
        load: loaderEntries,
      }),
      tex: Object.assign({}, texConfig, {
        inlineMath: [["\\(", "\\)"], ["$", "$"]],
        displayMath: [["\\[", "\\]"], ["$$", "$$"]],
        packages: Object.assign({}, texConfig.packages || {}, { "[+]": ["ams", "noerrors", "noundefined"] }),
      }),
      options: Object.assign({}, optionsConfig, {
        skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      }),
      startup: Object.assign({}, startupConfig, {
        typeset: false,
      }),
    });

    const script = document.createElement("script");
    script.src = MATHJAX_CDN_URL;
    script.async = true;
    script.dataset.piStudioMathjax = "1";
    script.onload = () => {
      const api = window.MathJax;
      if (api && api.startup && api.startup.promise && typeof api.startup.promise.then === "function") {
        api.startup.promise.then(() => resolve(api)).catch(reject);
        return;
      }
      if (api && typeof api.typesetPromise === "function") {
        resolve(api);
        return;
      }
      reject(new Error("MathJax did not initialize."));
    };
    script.onerror = () => {
      reject(new Error("Failed to load MathJax."));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    mathJaxPromise = null;
    throw error;
  });

  return mathJaxPromise;
}

async function renderMathFallbackInElement(targetEl) {
  const fallbackTargets = collectMathFallbackTargets(targetEl);
  if (fallbackTargets.length === 0) return;

  fallbackTargets.forEach((entry) => {
    entry.renderTarget.classList.add("studio-mathjax-fallback");
    if (entry.displayMode) {
      entry.renderTarget.classList.add("studio-mathjax-fallback-display");
      entry.renderTarget.textContent = "\\[\n" + entry.tex + "\n\\]";
    } else {
      entry.renderTarget.textContent = "\\(" + entry.tex + "\\)";
    }
  });

  let mathJax;
  try {
    mathJax = await ensureMathJax();
  } catch (error) {
    console.error("MathJax load failed:", error);
    appendMathFallbackNotice(targetEl, MATHJAX_UNAVAILABLE_MESSAGE);
    return;
  }

  try {
    await mathJax.typesetPromise(fallbackTargets.map((entry) => entry.renderTarget));
  } catch (error) {
    console.error("MathJax fallback render failed:", error);
    appendMathFallbackNotice(targetEl, MATHJAX_RENDER_FAIL_MESSAGE);
  }
}

async function renderMarkdownWithPandoc(markdown) {
  if (typeof fetch !== "function") {
    throw new Error("Browser fetch API is unavailable.");
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 8000) : null;

  let response;
  try {
    response = await fetch(buildAuthenticatedPath("/api/render-preview"), {
      method: "POST",
      headers: buildAuthenticatedHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        markdown: String(markdown || ""),
        sourcePath: getEffectiveSourcePath(),
        resourceDir: (!getEffectiveSourcePath() && state.workingDir) ? state.workingDir : "",
      }),
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Preview request timed out.");
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }

  const rawBody = await response.text();
  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload && typeof payload.error === "string"
      ? payload.error
      : `Preview request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (!payload || payload.ok !== true || typeof payload.html !== "string") {
    const message = payload && typeof payload.error === "string"
      ? payload.error
      : "Preview renderer returned an invalid payload.";
    throw new Error(message);
  }

  return payload.html;
}

function parseContentDispositionFilename(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return "";

  const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch {
      return utfMatch[1].trim();
    }
  }

  const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedMatch && quotedMatch[1]) return quotedMatch[1].trim();

  const plainMatch = headerValue.match(/filename=([^;]+)/i);
  if (plainMatch && plainMatch[1]) return plainMatch[1].trim();

  return "";
}

function hasAnnotationMarkers(text) {
  const source = String(text || "");
  ANNOTATION_MARKER_REGEX.lastIndex = 0;
  const hasMarker = ANNOTATION_MARKER_REGEX.test(source);
  ANNOTATION_MARKER_REGEX.lastIndex = 0;
  return hasMarker;
}

function stripAnnotationMarkers(text) {
  return String(text || "").replace(ANNOTATION_MARKER_REGEX, "");
}

function prepareEditorTextForSend(text) {
  const raw = String(text || "");
  return state.annotationsEnabled ? raw : stripAnnotationMarkers(raw);
}

function prepareEditorTextForPreview(text) {
  const raw = String(text || "");
  return state.annotationsEnabled ? raw : stripAnnotationMarkers(raw);
}

function beginPreviewRender(targetEl) {
  if (!targetEl) return;
  targetEl.classList.add("preview-pending");
}

function finishPreviewRender(targetEl) {
  if (!targetEl) return;
  targetEl.classList.remove("preview-pending");
}

function scheduleResponsePaneRepaintNudge() {
  if (!elements.responseView || typeof elements.responseView.getBoundingClientRect !== "function") return;
  const schedule = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (cb) => window.setTimeout(cb, 16);

  schedule(() => {
    if (!elements.responseView || !elements.responseView.isConnected) return;
    void elements.responseView.getBoundingClientRect();
    if (!elements.responseView.classList) return;
    elements.responseView.classList.add("response-repaint-nudge");
    schedule(() => {
      if (!elements.responseView || !elements.responseView.classList) return;
      elements.responseView.classList.remove("response-repaint-nudge");
    });
  });
}

function applyPendingResponseScrollReset() {
  if (!state.pendingResponseScrollReset || !elements.responseView) return false;
  if (state.rightView === "editor-preview") return false;
  elements.responseView.scrollTop = 0;
  elements.responseView.scrollLeft = 0;
  state.pendingResponseScrollReset = false;
  return true;
}

function getDisplayedResponseIdentityKey(display) {
  if (!display) return "";
  if (display.kind === "history" && display.item?.localPromptId) {
    return `response:${display.item.localPromptId}`;
  }
  if (display.kind === "active" && display.turn?.localPromptId) {
    return `response:${display.turn.localPromptId}`;
  }
  return "";
}

function updatePendingResponseScrollReset(display) {
  if (state.rightView === "editor-preview") {
    state.pendingResponseScrollReset = false;
    return;
  }

  const nextKey = getDisplayedResponseIdentityKey(display);
  if (!nextKey) {
    state.lastResponseIdentityKey = "";
    state.pendingResponseScrollReset = false;
    return;
  }
  if (state.lastResponseIdentityKey !== nextKey) {
    state.pendingResponseScrollReset = true;
  }
  state.lastResponseIdentityKey = nextKey;
}

function shouldUseCodePreviewForLanguage(language) {
  const normalized = normalizeFenceLanguage(language);
  return Boolean(normalized) && normalized !== "markdown" && normalized !== "latex";
}

function getPreviewSource() {
  if (state.rightView === "editor-preview") {
    const markdown = prepareEditorTextForPreview(elements.promptInput.value || "");
    const latest = getLatestHistoryItem();
    const latestTime = formatReferenceTime(latest?.completedAt ?? latest?.submittedAt ?? 0);
    const suffix = latest
      ? (latestTime ? ` · response updated ${latestTime}` : " · response available")
      : "";
    const previewLanguage = String(state.editorLanguage || "");
    const renderKind = shouldUseCodePreviewForLanguage(previewLanguage) ? "code" : "pandoc";
    return {
      mode: "editor-preview",
      renderKind,
      highlightLanguage: previewLanguage,
      markdown,
      emptyMessage: "Editor is empty.",
      key: `editor-preview\u0000${renderKind}\u0000${previewLanguage}\u0000${markdown}`,
      referenceLabel: `Previewing: editor text${suffix}`,
      previewWarning: "",
    };
  }

  const display = getDisplayedResponse();
  const responseId = display.kind === "history"
    ? display.item?.localPromptId || "none"
    : (display.kind === "active" ? display.turn?.localPromptId || "active" : "none");
  const previewMarkdown = state.annotationsEnabled ? display.markdown : stripAnnotationMarkers(display.markdown);
  return {
    mode: "preview",
    renderKind: "pandoc",
    highlightLanguage: "",
    markdown: previewMarkdown,
    emptyMessage: display.text,
    key: `preview\u0000${display.kind}\u0000${responseId}\u0000${previewMarkdown}\u0000${display.previewWarning || ""}`,
    referenceLabel: getResponseReferenceLabel(display),
    previewWarning: display.previewWarning || "",
  };
}

function getPdfExportSource() {
  if (state.rightView !== "preview" && state.rightView !== "editor-preview") {
    return null;
  }

  const previewSource = getPreviewSource();
  const markdown = String(previewSource?.markdown || "");
  if (!normalizedText(markdown)) {
    return null;
  }

  const sourcePath = getEffectiveSourcePath();
  const resourceDir = (!sourcePath && state.workingDir) ? state.workingDir : "";
  const editorPdfLanguage = state.rightView === "editor-preview" ? String(state.editorLanguage || "") : "";
  const isLatex = state.rightView === "editor-preview"
    ? editorPdfLanguage === "latex"
    : /\\documentclass\b|\\begin\{document\}/.test(markdown);

  let filenameHint = state.rightView === "editor-preview"
    ? "studio-editor-preview.pdf"
    : "studio-response-preview.pdf";
  if (sourcePath) {
    const baseName = sourcePath.split(/[\\/]/).pop() || "studio";
    const stem = baseName.replace(/\.[^.]+$/, "") || "studio";
    filenameHint = `${stem}-preview.pdf`;
  }

  return {
    markdown,
    sourcePath,
    resourceDir,
    editorPdfLanguage,
    isLatex,
    filenameHint,
  };
}

function setResponseViewHtml(html) {
  elements.responseView.innerHTML = html;
}

function appendPreviewWarning(targetEl, message) {
  if (!targetEl || !message) return;
  const warningEl = document.createElement("div");
  warningEl.className = "preview-warning";
  warningEl.textContent = String(message);
  targetEl.append(warningEl);
}

function cancelScheduledResponsePreviewRender() {
  if (!state.responsePreviewTimer) return;
  window.clearTimeout(state.responsePreviewTimer);
  state.responsePreviewTimer = null;
}

function scheduleResponsePreviewRender(delayMs = 0) {
  cancelScheduledResponsePreviewRender();
  const delay = Math.max(0, delayMs);
  state.responsePreviewTimer = window.setTimeout(() => {
    state.responsePreviewTimer = null;
    void renderResponsePreviewNow();
  }, delay);
}

async function renderResponsePreviewNow() {
  if (state.rightView !== "preview" && state.rightView !== "editor-preview") {
    return;
  }

  const source = getPreviewSource();
  if (!source.markdown.trim()) {
    state.currentRenderedPreviewKey = source.key;
    finishPreviewRender(elements.responseView);
    setResponseViewHtml(buildPlainMarkdownHtml(source.emptyMessage));
    if (source.previewWarning) {
      appendPreviewWarning(elements.responseView, source.previewWarning);
    }
    applyPendingResponseScrollReset();
    scheduleResponsePaneRepaintNudge();
    elements.referenceBadge.textContent = source.referenceLabel;
    return;
  }

  if (state.currentRenderedPreviewKey === source.key) {
    elements.referenceBadge.textContent = source.referenceLabel;
    return;
  }

  const nonce = ++state.responsePreviewRenderNonce;
  beginPreviewRender(elements.responseView);
  elements.referenceBadge.textContent = source.referenceLabel;

  try {
    if (source.renderKind === "code") {
      if (nonce !== state.responsePreviewRenderNonce || state.rightView !== source.mode) return;
      finishPreviewRender(elements.responseView);
      setResponseViewHtml(`<div class="response-markdown-highlight">${highlightCode(source.markdown, source.highlightLanguage)}</div>`);
      if (source.previewWarning) {
        appendPreviewWarning(elements.responseView, source.previewWarning);
      }
      applyPendingResponseScrollReset();
      scheduleResponsePaneRepaintNudge();
      elements.referenceBadge.textContent = source.referenceLabel;
      state.currentRenderedPreviewKey = source.key;
      return;
    }

    const renderedHtml = await renderMarkdownWithPandoc(source.markdown);
    if (nonce !== state.responsePreviewRenderNonce || state.rightView !== source.mode) return;
    finishPreviewRender(elements.responseView);
    setResponseViewHtml(sanitizeRenderedHtml(renderedHtml, source.markdown));
    decoratePdfEmbeds(elements.responseView);
    await renderPdfPreviewsInElement(elements.responseView);
    applyAnnotationMarkersToElement(elements.responseView, state.annotationsEnabled ? "highlight" : "hide");
    await renderMathFallbackInElement(elements.responseView);
    if (source.previewWarning) {
      appendPreviewWarning(elements.responseView, source.previewWarning);
    }
    applyPendingResponseScrollReset();
    scheduleResponsePaneRepaintNudge();
    elements.referenceBadge.textContent = source.referenceLabel;
    state.currentRenderedPreviewKey = source.key;
  } catch (error) {
    if (nonce !== state.responsePreviewRenderNonce || state.rightView !== source.mode) return;
    const detail = error && error.message ? error.message : String(error || "unknown error");
    finishPreviewRender(elements.responseView);
    setResponseViewHtml(buildPreviewErrorHtml(`Preview renderer unavailable (${detail}). Showing plain markdown.`, source.markdown));
    if (source.previewWarning) {
      appendPreviewWarning(elements.responseView, source.previewWarning);
    }
    applyPendingResponseScrollReset();
    scheduleResponsePaneRepaintNudge();
    elements.referenceBadge.textContent = source.referenceLabel;
    state.currentRenderedPreviewKey = source.key;
  }
}

function formatPromptDescriptor(turn) {
  if (!turn) return "-";
  if (turn.promptMode === "run") {
    return getRequestKind(turn) === "critique"
      ? `chain ${turn.chainIndex} · critique`
      : `chain ${turn.chainIndex} · run`;
  }
  return `chain ${turn.chainIndex} · steer ${turn.promptSteeringCount}`;
}

function buildResponseDisplayText(item) {
  if (!item) return "No response yet. Run editor text or critique editor text.";
  const responseText = String(item.responseText || "");
  if (item.responseError) {
    return responseText.trim()
      ? `error: ${item.responseError}\n\n${responseText}`
      : `error: ${item.responseError}`;
  }
  return responseText.trim() ? responseText : "(empty response)";
}

function buildThinkingDisplayText(item) {
  if (!item) return "No thinking available for this response.";
  const thinkingText = String(item.responseThinking || "");
  return thinkingText.trim() ? thinkingText : "No thinking available for this response.";
}

function getActiveTurnMarkdown(turn) {
  if (!turn) return "";
  return String(turn.outputPreview || turn.responseText || "");
}

function getResponseReferenceLabel(display) {
  if (!display) return "Latest response: none";
  if (display.kind === "history" && display.item) {
    const selectedIndex = getSelectedHistoryIndex();
    const total = getHistory().length;
    const selectedLabel = total > 0 && selectedIndex >= 0 ? `${selectedIndex + 1}/${total}` : `0/${total}`;
    const item = display.item;
    const time = formatReferenceTime(item.completedAt ?? item.submittedAt ?? 0);
    const responseLabel = isCritiqueHistoryItem(item) ? "assistant critique" : "assistant response";
    return time
      ? `Response history ${selectedLabel} · ${responseLabel} · ${time}`
      : `Response history ${selectedLabel} · ${responseLabel}`;
  }
  if (display.kind === "active" && display.turn) {
    const time = formatReferenceTime(display.turn.firstOutputTextAt ?? display.turn.firstAssistantMessageAt ?? display.turn.submittedAt ?? 0);
    const responseLabel = getRequestKind(display.turn) === "critique" ? "Assistant critique in progress" : "Assistant response in progress";
    return time
      ? `${responseLabel} · ${time}`
      : responseLabel;
  }
  return "Latest response: none";
}

function getThinkingReferenceLabel(display) {
  if (!display) return "Thinking: none";
  if (display.kind === "history" && display.item) {
    const selectedIndex = getSelectedHistoryIndex();
    const total = getHistory().length;
    const selectedLabel = total > 0 && selectedIndex >= 0 ? `${selectedIndex + 1}/${total}` : `0/${total}`;
    const item = display.item;
    const hasThinking = Boolean(normalizedText(item.responseThinking || ""));
    const time = formatReferenceTime(item.completedAt ?? item.submittedAt ?? 0);
    const label = hasThinking ? "assistant thinking" : "assistant thinking unavailable";
    return time
      ? `Response history ${selectedLabel} · ${label} · ${time}`
      : `Response history ${selectedLabel} · ${label}`;
  }
  if (display.kind === "active" && display.turn) {
    const time = formatReferenceTime(display.turn.firstAssistantMessageAt ?? display.turn.submittedAt ?? 0);
    return time
      ? `Assistant thinking in progress · ${time}`
      : "Assistant thinking in progress";
  }
  return "Thinking: none";
}

function getDisplayedResponse() {
  const activeTurn = state.followLatest ? state.snapshot?.activeTurn : null;
  const activeMarkdown = activeTurn ? getActiveTurnMarkdown(activeTurn) : "";
  const activeHasContent = Boolean(normalizedText(activeMarkdown));

  if (activeTurn && activeHasContent) {
    return {
      kind: "active",
      text: activeMarkdown,
      markdown: activeMarkdown,
      hasContent: true,
      turn: activeTurn,
      previewWarning: "",
    };
  }

  const selected = getSelectedHistoryItem();
  if (selected) {
    const markdown = String(selected.responseText || "");
    return {
      kind: "history",
      text: buildResponseDisplayText(selected),
      markdown,
      hasContent: Boolean(normalizedText(markdown)),
      previewWarning: selected.responseError ? `Response ended with error: ${selected.responseError}` : "",
      item: selected,
    };
  }

  if (activeTurn) {
    return {
      kind: "active",
      text: getRequestKind(activeTurn) === "critique"
        ? "Waiting for the active critique to produce a response."
        : "Waiting for the active turn to produce a response.",
      markdown: "",
      hasContent: false,
      turn: activeTurn,
      previewWarning: "",
    };
  }

  return {
    kind: "empty",
    text: "No response yet. Run editor text or critique editor text.",
    markdown: "",
    hasContent: false,
    previewWarning: "",
  };
}

function getDisplayedThinking() {
  const responseDisplay = getDisplayedResponse();
  if (responseDisplay.kind === "history" && responseDisplay.item) {
    const thinking = String(responseDisplay.item.responseThinking || "");
    return {
      kind: "history",
      text: buildThinkingDisplayText(responseDisplay.item),
      markdown: thinking,
      hasContent: Boolean(normalizedText(thinking)),
      item: responseDisplay.item,
      previewWarning: "",
    };
  }

  if (responseDisplay.kind === "active" && responseDisplay.turn) {
    return {
      kind: "active",
      text: "Waiting for the active turn to finish before thinking becomes available.",
      markdown: "",
      hasContent: false,
      turn: responseDisplay.turn,
      previewWarning: "",
    };
  }

  return {
    kind: "empty",
    text: "No thinking available for this response.",
    markdown: "",
    hasContent: false,
    previewWarning: "",
  };
}

function appendMetaRow(container, label, value) {
  const row = document.createElement("div");
  row.className = "meta";

  const labelNode = document.createElement("span");
  labelNode.textContent = `${label}: `;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  container.append(row);
}

function buildDetailBlock(title, text) {
  const block = document.createElement("div");
  block.className = "detail-block";

  const heading = document.createElement("h4");
  heading.textContent = title;

  const body = document.createElement("pre");
  body.textContent = text || "";

  block.append(heading, body);
  return block;
}

function formatTurnSummary(turn) {
  if (!turn) return [];
  const now = state.snapshot?.now || Date.now();
  const effectiveEnd = turn.completedAt || now;
  return [
    ["Prompt", formatPromptDescriptor(turn)],
    ["Request", getRequestKind(turn)],
    ["Critique focus", turn.critiqueLens || "-"],
    ["Submitted", formatAbsoluteTime(turn.submittedAt)],
    ["To busy", formatRelativeDuration(turn.submittedAt, turn.backendBusyAt)],
    ["To first assistant", formatRelativeDuration(turn.submittedAt, turn.firstAssistantMessageAt)],
    ["To first output", formatRelativeDuration(turn.submittedAt, turn.firstOutputTextAt)],
    ["Elapsed", formatRelativeDuration(turn.submittedAt, effectiveEnd)],
    ["Latest message", turn.latestAssistantMessageId || "-"],
    ["Latest part", turn.latestPartType || "-"],
  ];
}

function renderTurnPanel(container, turn, emptyText) {
  if (!turn) {
    container.textContent = emptyText;
    container.className = "panel-scroll diagnostics-body empty-state";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "detail-body";

  const metaBlock = document.createElement("div");
  metaBlock.className = "detail-block";
  const heading = document.createElement("h4");
  heading.textContent = "Timing";
  metaBlock.append(heading);
  for (const [label, value] of formatTurnSummary(turn)) {
    appendMetaRow(metaBlock, label, value);
  }

  wrapper.append(
    metaBlock,
    buildDetailBlock("Live output preview", turn.outputPreview || "(no output text observed yet)"),
    buildDetailBlock(
      "Completion",
      turn.completedAt
        ? `${turn.responseError ? `error: ${turn.responseError}` : "completed"}\n${turn.responseText || ""}`.trim()
        : "Still running or waiting for completion.",
    ),
    buildDetailBlock("Prompt text", turn.promptText),
  );

  container.innerHTML = "";
  container.className = "panel-scroll diagnostics-body";
  container.append(wrapper);
}

function renderSelectionPanel() {
  const item = getSelectedHistoryItem();
  if (!item) {
    elements.selectionPanel.textContent = "No response selected yet.";
    elements.selectionPanel.className = "panel-scroll diagnostics-body empty-state";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "detail-body";

  const metaBlock = document.createElement("div");
  metaBlock.className = "detail-block";
  const metaHeading = document.createElement("h4");
  metaHeading.textContent = "Metadata";
  metaBlock.append(metaHeading);
  appendMetaRow(metaBlock, "chain", String(item.chainIndex));
  appendMetaRow(metaBlock, "mode", item.promptMode);
  appendMetaRow(metaBlock, "request", getRequestKind(item));
  appendMetaRow(metaBlock, "critique focus", item.critiqueLens || "-");
  appendMetaRow(metaBlock, "steering count", String(item.promptSteeringCount));
  appendMetaRow(metaBlock, "queued while busy", item.queuedWhileBusy ? "yes" : "no");
  appendMetaRow(metaBlock, "submitted", formatAbsoluteTime(item.submittedAt));
  appendMetaRow(metaBlock, "completed", item.completedAt ? formatAbsoluteTime(item.completedAt) : "-");
  appendMetaRow(metaBlock, "duration", item.completedAt ? formatRelativeDuration(item.submittedAt, item.completedAt) : "-");
  appendMetaRow(metaBlock, "user message", item.userMessageId || "-");
  appendMetaRow(metaBlock, "response message", item.responseMessageId || "-");
  appendMetaRow(metaBlock, "response error", item.responseError || "-");

  wrapper.append(
    metaBlock,
    buildDetailBlock("Prompt text", item.promptText),
    buildDetailBlock("Effective prompt", item.effectivePrompt),
    buildDetailBlock("Response text", buildResponseDisplayText(item)),
    buildDetailBlock("Thinking text", buildThinkingDisplayText(item)),
  );

  elements.selectionPanel.innerHTML = "";
  elements.selectionPanel.className = "panel-scroll diagnostics-body";
  elements.selectionPanel.append(wrapper);
}

function renderHistoryDiagnostics() {
  const history = getHistory();
  if (!history.length) {
    elements.historyList.innerHTML = '<div class="empty-state">No responses yet.</div>';
    return;
  }

  const groups = groupHistoryByChain(history);
  const fragment = document.createDocumentFragment();

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "history-group";

    const header = document.createElement("div");
    header.className = "history-group-header";

    const title = document.createElement("strong");
    title.textContent = `Chain ${group.chainIndex}`;

    const summary = document.createElement("span");
    const steerCount = group.items.filter((item) => item.promptMode === "steer").length;
    const latest = group.items.at(-1);
    summary.textContent = `${group.items.length} item${group.items.length === 1 ? "" : "s"} · ${steerCount} steer${steerCount === 1 ? "" : "s"} · latest ${latest ? formatAbsoluteTime(latest.completedAt ?? latest.submittedAt) : "-"}`;

    header.append(title, summary);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "history-group-items";

    for (const item of group.items) {
      const card = document.createElement("div");
      card.className = `history-item${item.localPromptId === state.selectedPromptId ? " selected" : ""}`;
      card.addEventListener("click", () => {
        state.followLatest = false;
        state.selectedPromptId = item.localPromptId;
        render();
      });

      const topRow = document.createElement("div");
      topRow.className = "row";

      const itemTitle = document.createElement("strong");
      itemTitle.textContent = getHistoryItemTitle(item);

      const time = document.createElement("span");
      time.className = "meta";
      time.textContent = formatAbsoluteTime(item.submittedAt);

      topRow.append(itemTitle, time);

      const badges = document.createElement("div");
      badges.className = "badges";
      for (const [text, className] of [
        [item.promptMode, item.promptMode],
        [getRequestKind(item), getRequestKind(item) === "critique" ? "critique" : ""],
        [`steers:${item.promptSteeringCount}`, ""],
        [item.queuedWhileBusy ? "queued-busy" : "direct", ""],
        [item.responseError ? "error" : "ok", item.responseError ? "error" : ""],
      ]) {
        const badge = document.createElement("span");
        badge.className = `badge ${className}`.trim();
        badge.textContent = text;
        badges.append(badge);
      }

      const snippet = document.createElement("p");
      snippet.className = "snippet";
      snippet.textContent = normalizedText(item.responseText || item.responseError || item.promptText).replace(/\s+/g, " ").slice(0, 180) || "(empty response)";

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `prompt=${item.localPromptId.slice(0, 12)} · response=${item.responseMessageId ? item.responseMessageId.slice(0, 12) : "-"}`;

      card.append(topRow, badges, snippet, meta);
      itemsWrap.append(card);
    }

    section.append(header, itemsWrap);
    fragment.append(section);
  }

  elements.historyList.innerHTML = "";
  elements.historyList.append(fragment);
}

function renderLogs() {
  const lines = Array.isArray(state.snapshot?.logs) ? state.snapshot.logs : [];
  elements.logSummary.textContent = `${lines.length} line${lines.length === 1 ? "" : "s"}`;
  elements.logOutput.textContent = lines
    .map((entry) => `[${formatAbsoluteTime(entry.at)}] ${entry.line}`)
    .join("\n");
}

function renderDiagnostics() {
  elements.diagnosticsPanel.hidden = !state.diagnosticsOpen;
  elements.diagnosticsBtn.classList.toggle("active", state.diagnosticsOpen);
  if (!state.diagnosticsOpen) return;
  renderTurnPanel(elements.activeTurnPanel, state.snapshot?.activeTurn ?? null, "No active turn yet.");
  renderTurnPanel(elements.lastTurnPanel, state.snapshot?.lastCompletedTurn ?? null, "No completed turn yet.");
  renderSelectionPanel();
  renderHistoryDiagnostics();
  renderLogs();
}

function renderResponsePane() {
  const history = getHistory();
  const selectedIndex = getSelectedHistoryIndex();
  const responseDisplay = getDisplayedResponse();
  const display = state.rightView === "thinking" ? getDisplayedThinking() : responseDisplay;
  updatePendingResponseScrollReset(display);

  if (elements.rightViewSelect) {
    elements.rightViewSelect.value = state.rightView;
  }

  const selected = history.length && selectedIndex >= 0 ? selectedIndex + 1 : 0;
  elements.historyIndexBadge.textContent = `History: ${selected}/${history.length}`;

  if (state.rightView === "thinking") {
    cancelScheduledResponsePreviewRender();
    finishPreviewRender(elements.responseView);
    state.responsePreviewRenderNonce += 1;
    const thinkingText = String(display.text || "");
    state.currentRenderedPreviewKey = `thinking\u0000${display.kind}\u0000${thinkingText}`;
    setResponseViewHtml(buildPlainMarkdownHtml(thinkingText));
    applyPendingResponseScrollReset();
    scheduleResponsePaneRepaintNudge();
    elements.referenceBadge.textContent = getThinkingReferenceLabel(display);
    return;
  }

  if (state.rightView === "markdown") {
    cancelScheduledResponsePreviewRender();
    finishPreviewRender(elements.responseView);
    state.responsePreviewRenderNonce += 1;
    const responseText = String(display.text || "");
    state.currentRenderedPreviewKey = `raw\u0000${state.responseHighlightEnabled ? "highlight" : "plain"}\u0000${display.kind}\u0000${responseText}`;

    if (!normalizedText(responseText)) {
      setResponseViewHtml(buildPlainMarkdownHtml(responseText));
    } else if (state.responseHighlightEnabled) {
      if (responseText.length > RESPONSE_HIGHLIGHT_MAX_CHARS) {
        setResponseViewHtml(buildPreviewErrorHtml(
          "Response is too large for markdown highlighting. Showing plain markdown.",
          responseText,
        ));
      } else {
        setResponseViewHtml(`<div class="response-markdown-highlight">${highlightMarkdown(responseText)}</div>`);
      }
    } else {
      setResponseViewHtml(buildPlainMarkdownHtml(responseText));
    }

    applyPendingResponseScrollReset();
    scheduleResponsePaneRepaintNudge();
    elements.referenceBadge.textContent = getResponseReferenceLabel(display);
    return;
  }

  scheduleResponsePreviewRender(state.rightView === "editor-preview" ? 120 : 0);
}

function renderEditorMeta() {
  const snapshot = state.snapshot;
  const history = getHistory();
  const selectedIndex = getSelectedHistoryIndex();
  const display = state.rightView === "thinking" ? getDisplayedThinking() : getDisplayedResponse();
  const editorTextNormalized = normalizedText(elements.promptInput.value);
  const displayedResponseNormalized = display?.hasContent ? normalizedText(display.markdown) : "";
  const inSync = Boolean(displayedResponseNormalized) && editorTextNormalized === displayedResponseNormalized;

  elements.sourceBadge.textContent = `Editor origin: ${state.editorOriginLabel}`;
  if (elements.resourceDirLabel) {
    elements.resourceDirLabel.textContent = state.workingDir ? `Working dir: ${state.workingDir}` : "";
  }
  if (elements.resourceDirInput) {
    elements.resourceDirInput.value = state.workingDirEditorOpen ? state.workingDirDraft : state.workingDir;
  }
  showWorkingDirState(
    state.sourcePath
      ? "button"
      : (state.workingDirEditorOpen ? "input" : (state.workingDir ? "label" : "button")),
  );
  elements.queueBadge.textContent = `Queue: ${snapshot?.state?.queueLength ?? 0}`;
  elements.composerStatusBadge.textContent = `Run state: ${snapshot?.state?.runState ?? "-"}`;
  elements.backendStatusBadge.textContent = `Backend: ${snapshot?.state?.lastBackendStatus ?? "-"}`;
  elements.historyCountBadge.textContent = `History: ${history.length && selectedIndex >= 0 ? selectedIndex + 1 : 0}/${history.length}`;
  elements.syncBadge.hidden = !inSync;
  elements.syncBadge.classList.toggle("sync", inSync);
  elements.syncBadge.textContent = state.rightView === "thinking" ? "In sync with thinking" : "In sync with response";
  if (elements.annotationModeSelect) {
    elements.annotationModeSelect.value = state.annotationsEnabled ? "on" : "off";
    elements.annotationModeSelect.title = state.annotationsEnabled
      ? "Annotations On: keep and send [an: ...] markers."
      : "Annotations Hidden: keep markers in editor, hide in preview, and strip before Run / Queue steering.";
  }
  if (elements.highlightSelect) {
    elements.highlightSelect.value = state.editorHighlightEnabled ? "on" : "off";
  }
  if (elements.langSelect) {
    elements.langSelect.value = state.editorLanguage;
  }
  if (elements.sourceHighlight) {
    elements.sourceHighlight.hidden = !state.editorHighlightEnabled;
  }
  if (elements.stripAnnotationsBtn) {
    elements.stripAnnotationsBtn.disabled = state.busy || !hasAnnotationMarkers(elements.promptInput.value);
  }
  if (elements.saveAnnotatedBtn) {
    elements.saveAnnotatedBtn.disabled = state.busy || !normalizedText(elements.promptInput.value);
  }
  updateAnnotatedReplyHeaderButton();
  elements.promptInput.classList.toggle("highlight-active", state.editorHighlightEnabled);
}

function startSpinner() {
  if (state.spinnerTimer) return;
  state.spinnerFrameIndex = 0;
  elements.statusLine.classList.add("with-spinner");
  elements.statusSpinner.textContent = BRAILLE_SPINNER_FRAMES[state.spinnerFrameIndex];
  state.spinnerTimer = window.setInterval(() => {
    state.spinnerFrameIndex = (state.spinnerFrameIndex + 1) % BRAILLE_SPINNER_FRAMES.length;
    elements.statusSpinner.textContent = BRAILLE_SPINNER_FRAMES[state.spinnerFrameIndex];
  }, 90);
}

function stopSpinner() {
  if (state.spinnerTimer) {
    window.clearInterval(state.spinnerTimer);
    state.spinnerTimer = null;
  }
  elements.statusLine.classList.remove("with-spinner");
  elements.statusSpinner.textContent = "";
}

function applyStatus(message, level = "", spinning = false) {
  elements.status.textContent = message;
  elements.status.className = level || "";
  if (spinning) {
    startSpinner();
  } else {
    stopSpinner();
  }
}

function deriveStatus() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return { message: "Connecting · Studio bridge starting…", level: "", spinning: true };
  }
  if (snapshot.state.lastError) {
    return { message: `Error · ${snapshot.state.lastError}`, level: "error", spinning: false };
  }
  if (state.busy) {
    return { message: "Studio: sending request to the attached session…", level: "", spinning: true };
  }
  if (snapshot.state.runState === "stopping") {
    return {
      message: getRequestKind(snapshot.activeTurn) === "critique"
        ? "Studio: stopping current critique…"
        : "Studio: stopping current run…",
      level: "warning",
      spinning: true,
    };
  }
  if (snapshot.state.runState === "running") {
    const activeTurn = snapshot.activeTurn;
    const elapsed = activeTurn ? formatRelativeDuration(activeTurn.submittedAt, snapshot.now) : "-";
    const queueLength = snapshot.state.queueLength ?? 0;
    const queueSuffix = queueLength > 0 ? ` · ${queueLength} queued` : "";
    const variant = String(snapshot.currentModel?.variant || "").trim();
    const variantSuffix = variant ? ` · ${variant}` : "";
    let action = "Studio: waiting for queued steering";
    if (activeTurn) {
      if (activeTurn.promptMode === "run") {
        if (getRequestKind(activeTurn) === "critique") {
          action = activeTurn.firstOutputTextAt
            ? "Studio: generating critique"
            : "Studio: running critique";
        } else {
          action = activeTurn.firstOutputTextAt
            ? "Studio: generating response"
            : "Studio: running editor text";
        }
      } else {
        action = activeTurn.firstOutputTextAt
          ? `Studio: generating steering ${activeTurn.promptSteeringCount}`
          : `Studio: queueing steering ${activeTurn.promptSteeringCount}`;
      }
    }
    const elapsedSuffix = elapsed !== "-" ? ` · ${elapsed}` : "";
    return { message: `${action}…${elapsedSuffix}${queueSuffix}${variantSuffix}`, level: "", spinning: true };
  }
  if (snapshot.state.lastBackendStatus === "busy") {
    const variant = String(snapshot.currentModel?.variant || "").trim();
    const variantSuffix = variant ? ` · ${variant}` : "";
    const agentLabel = formatAgentLabel(snapshot);
    const source = snapshot.currentModel?.source;
    const action = source === "assistant"
      ? "Attached terminal: generating response"
      : (agentLabel ? `Attached terminal: ${agentLabel} running` : "Attached terminal: running");
    return { message: `${action}…${variantSuffix}`, level: "", spinning: true };
  }

  const history = getHistory();
  const latest = getLatestHistoryItem();
  if (latest) {
    const selectedIndex = getSelectedHistoryIndex();
    const selected = history.length && selectedIndex >= 0 ? selectedIndex + 1 : history.length;
    const time = formatReferenceTime(latest.completedAt ?? latest.submittedAt ?? 0);
    const suffix = time ? ` · ${time}` : "";
    const readyLabel = isCritiqueHistoryItem(latest) ? "critique" : "response";
    return {
      message: `Ready · ${readyLabel} ${selected}/${history.length}${suffix}`,
      level: "",
      spinning: false,
    };
  }

  return {
    message: "Ready · attached to active session.",
    level: "",
    spinning: false,
  };
}

function renderStatusLine() {
  const transient = state.transientStatus;
  if (transient && transient.expiresAt > Date.now()) {
    applyStatus(transient.message, transient.level, false);
    return;
  }
  state.transientStatus = null;
  const derived = deriveStatus();
  applyStatus(derived.message, derived.level, derived.spinning);
}

function setTransientStatus(message, level = "", durationMs = 2200) {
  state.transientStatus = {
    message,
    level,
    expiresAt: Date.now() + durationMs,
  };
  if (state.transientStatusTimer) {
    window.clearTimeout(state.transientStatusTimer);
  }
  state.transientStatusTimer = window.setTimeout(() => {
    state.transientStatus = null;
    renderStatusLine();
  }, durationMs + 20);
  renderStatusLine();
}

function renderFooterMeta() {
  const history = getHistory();
  const selectedIndex = getSelectedHistoryIndex();
  const selected = history.length && selectedIndex >= 0 ? selectedIndex + 1 : 0;
  const queue = state.snapshot?.state?.queueLength ?? 0;
  const parts = [];

  parts.push(formatModelSummary(state.snapshot));

  const projectLabel = formatProjectLabel(state.snapshot);
  if (projectLabel) {
    parts.push(`Project: ${projectLabel}`);
  }

  const agentLabel = formatAgentLabel(state.snapshot);
  if (agentLabel) {
    parts.push(`Agent: ${agentLabel}`);
  }

  parts.push(formatContextUsage(state.snapshot));

  elements.footerMetaText.textContent = parts.join(" · ");
  if (elements.footerMeta) {
    const titleParts = [];
    const directory = String(state.snapshot?.launchContext?.directory || "").trim();
    if (directory) titleParts.push(`Project directory: ${directory}`);
    const sessionLabel = formatSessionLabel(state.snapshot);
    if (sessionLabel) titleParts.push(`Session: ${sessionLabel}`);
    const sessionId = String(state.snapshot?.state?.sessionId || "").trim();
    if (sessionId) titleParts.push(`Session ID: ${sessionId}`);
    const baseUrl = String(state.snapshot?.launchContext?.baseUrl || "").trim();
    if (baseUrl) titleParts.push(`Opencode server: ${baseUrl}`);
    titleParts.push(`History: ${selected}/${history.length}`);
    titleParts.push(`Queue: ${queue}`);
    const model = formatModel(state.snapshot);
    if (model && model !== "-") titleParts.push(`Model ID: ${model}`);
    const variant = String(state.snapshot?.currentModel?.variant || "").trim();
    if (variant) titleParts.push(`Thinking level: ${variant}`);
    const tokenUsage = state.snapshot?.currentModel?.tokenUsage;
    if (tokenUsage) {
      if (typeof tokenUsage.total === "number") titleParts.push(`Tokens total: ${tokenUsage.total}`);
      if (typeof tokenUsage.input === "number") titleParts.push(`Tokens input: ${tokenUsage.input}`);
      if (typeof tokenUsage.output === "number") titleParts.push(`Tokens output: ${tokenUsage.output}`);
      if (typeof tokenUsage.reasoning === "number") titleParts.push(`Tokens reasoning: ${tokenUsage.reasoning}`);
    }
    const contextLimit = state.snapshot?.currentModel?.contextLimit;
    if (typeof contextLimit === "number") titleParts.push(`Context limit: ${contextLimit}`);
    const themeInfo = state.snapshot?.launchContext?.theme || getStudioThemeInfo();
    const themeRaw = String(themeInfo?.raw || "").trim();
    const themePreference = String(themeInfo?.preference || "").trim();
    if (themeRaw) titleParts.push(`Theme: ${themeRaw}`);
    else if (themePreference) titleParts.push(`Theme mode: ${themePreference}`);
    elements.footerMeta.title = titleParts.join("\n");
  }
  updateDocumentTitle();
}

function updateActionState() {
  const snapshot = state.snapshot;
  const hasPrompt = Boolean(normalizedText(elements.promptInput.value));
  const runState = snapshot?.state?.runState ?? "idle";
  const activeRequestKind = getRequestKind(snapshot?.activeTurn);
  const runIsStop = runState === "running" && activeRequestKind !== "critique";
  const critiqueIsStop = runState === "running" && activeRequestKind === "critique";
  const stoppingRun = runState === "stopping" && activeRequestKind !== "critique";
  const stoppingCritique = runState === "stopping" && activeRequestKind === "critique";
  const selectedItem = getSelectedHistoryItem();
  const responseDisplay = getDisplayedResponse();
  const displayed = state.rightView === "thinking" ? getDisplayedThinking() : responseDisplay;
  const displayedResponseText = displayed?.hasContent ? normalizedText(displayed.markdown) : "";
  const history = getHistory();
  const selectedIndex = getSelectedHistoryIndex();
  const normalizedEditor = normalizedText(elements.promptInput.value);
  const selectedResponseItem = responseDisplay.kind === "history" ? responseDisplay.item : null;
  const critiqueHistoryItem = selectedResponseItem && isCritiqueHistoryItem(selectedResponseItem)
    ? selectedResponseItem
    : null;
  const structuredCritiqueItem = critiqueHistoryItem && isCritiqueResponseMarkdown(critiqueHistoryItem.responseText || "")
    ? critiqueHistoryItem
    : null;
  const critiqueNotes = structuredCritiqueItem ? buildCritiqueNotesMarkdown(structuredCritiqueItem.responseText || "") : "";
  const fullCritiqueText = structuredCritiqueItem ? String(structuredCritiqueItem.responseText || "") : "";
  const responseLoaded = Boolean(displayedResponseText) && normalizedEditor === displayedResponseText;
  const critiqueNotesLoaded = Boolean(critiqueNotes) && normalizedEditor === normalizedText(critiqueNotes);
  const fullCritiqueLoaded = Boolean(fullCritiqueText) && normalizedEditor === normalizedText(fullCritiqueText);

  elements.runBtn.textContent = stoppingRun ? "Stopping…" : (runIsStop ? "Stop" : "Run editor text");
  elements.runBtn.classList.toggle("request-stop-active", runIsStop || stoppingRun);
  elements.runBtn.disabled = !snapshot || state.busy || runState === "stopping" || (runState === "running" ? !runIsStop : !hasPrompt);

  if (elements.critiqueBtn) {
    elements.critiqueBtn.textContent = stoppingCritique ? "Stopping…" : (critiqueIsStop ? "Stop" : "Critique editor text");
    elements.critiqueBtn.classList.toggle("request-stop-active", critiqueIsStop || stoppingCritique);
    elements.critiqueBtn.disabled = !snapshot || state.busy || runState === "stopping" || (runState === "running" ? !critiqueIsStop : !hasPrompt);
  }

  elements.queueBtn.disabled = !snapshot || state.busy || runState !== "running" || activeRequestKind === "critique" || !hasPrompt;
  elements.copyDraftBtn.disabled = !hasPrompt;
  if (elements.saveAsBtn) elements.saveAsBtn.disabled = state.busy || !hasPrompt;
  if (elements.saveBtn) elements.saveBtn.disabled = state.busy || !hasPrompt || !getEffectiveSourcePath();
  if (elements.fileInput) elements.fileInput.disabled = state.busy;
  if (elements.fileInput?.closest(".file-label")) elements.fileInput.closest(".file-label").classList.toggle("is-disabled", state.busy);
  if (elements.loadGitDiffBtn) elements.loadGitDiffBtn.disabled = state.busy;
  if (elements.resourceDirBtn) elements.resourceDirBtn.disabled = state.busy || Boolean(state.sourcePath);
  if (elements.resourceDirInput) elements.resourceDirInput.disabled = state.busy || Boolean(state.sourcePath);
  if (elements.resourceDirClearBtn) elements.resourceDirClearBtn.disabled = state.busy || Boolean(state.sourcePath);
  if (elements.insertHeaderBtn) elements.insertHeaderBtn.disabled = state.busy;
  if (elements.annotationModeSelect) elements.annotationModeSelect.disabled = state.busy;
  if (elements.stripAnnotationsBtn) elements.stripAnnotationsBtn.disabled = state.busy || !hasAnnotationMarkers(elements.promptInput.value);
  if (elements.saveAnnotatedBtn) elements.saveAnnotatedBtn.disabled = state.busy || !hasPrompt;
  if (elements.lensSelect) elements.lensSelect.disabled = state.busy || runState !== "idle";
  if (elements.highlightSelect) elements.highlightSelect.disabled = state.busy;
  if (elements.langSelect) elements.langSelect.disabled = state.busy;
  if (elements.responseHighlightSelect) {
    elements.responseHighlightSelect.value = state.responseHighlightEnabled ? "on" : "off";
    elements.responseHighlightSelect.disabled = state.rightView !== "markdown";
  }

  elements.followSelect.value = state.followLatest ? "on" : "off";
  elements.historyPrevBtn.disabled = history.length === 0 || (!state.followLatest && selectedIndex <= 0) || (state.followLatest && history.length <= 1);
  elements.historyNextBtn.disabled = history.length === 0 || state.followLatest || selectedIndex < 0 || selectedIndex >= history.length - 1;
  elements.historyLastBtn.disabled = history.length === 0 || (state.followLatest && selectedIndex === history.length - 1);

  if (state.rightView === "thinking") {
    elements.loadResponseBtn.hidden = false;
    if (elements.loadCritiqueNotesBtn) elements.loadCritiqueNotesBtn.hidden = true;
    if (elements.loadCritiqueFullBtn) elements.loadCritiqueFullBtn.hidden = true;

    elements.loadResponseBtn.disabled = state.busy || !displayedResponseText || responseLoaded;
    elements.loadResponseBtn.textContent = !displayedResponseText
      ? "Thinking unavailable"
      : (responseLoaded ? "Thinking already in editor" : "Load thinking into editor");

    elements.copyResponseBtn.disabled = !displayedResponseText;
    elements.copyResponseBtn.textContent = "Copy thinking text";
  } else {
    const isStructuredCritique = Boolean(structuredCritiqueItem);
    elements.loadResponseBtn.hidden = isStructuredCritique;
    if (elements.loadCritiqueNotesBtn) elements.loadCritiqueNotesBtn.hidden = !isStructuredCritique;
    if (elements.loadCritiqueFullBtn) elements.loadCritiqueFullBtn.hidden = !isStructuredCritique;

    elements.loadResponseBtn.disabled = state.busy || !displayedResponseText || responseLoaded || isStructuredCritique;
    elements.loadResponseBtn.textContent = responseLoaded ? "Response already in editor" : "Load response into editor";

    if (elements.loadCritiqueNotesBtn) {
      elements.loadCritiqueNotesBtn.disabled = state.busy || !isStructuredCritique || !critiqueNotes || critiqueNotesLoaded;
      elements.loadCritiqueNotesBtn.textContent = critiqueNotesLoaded
        ? "Critique notes already in editor"
        : "Load critique notes into editor";
    }
    if (elements.loadCritiqueFullBtn) {
      elements.loadCritiqueFullBtn.disabled = state.busy || !isStructuredCritique || fullCritiqueLoaded;
      elements.loadCritiqueFullBtn.textContent = fullCritiqueLoaded
        ? "Full critique already in editor"
        : "Load full critique into editor";
    }

    elements.copyResponseBtn.disabled = !displayedResponseText;
    elements.copyResponseBtn.textContent = critiqueHistoryItem ? "Copy critique text" : "Copy response text";
  }

  if (!selectedItem) {
    elements.loadHistoryPromptBtn.disabled = true;
    elements.loadHistoryPromptBtn.textContent = getHistoryPromptButtonLabel(null);
  } else {
    const promptSource = selectedItem.promptMode === "steer" ? selectedItem.effectivePrompt : selectedItem.promptText;
    elements.loadHistoryPromptBtn.disabled = state.busy || !normalizedText(promptSource);
    elements.loadHistoryPromptBtn.textContent = getHistoryPromptButtonLabel(selectedItem);
  }

  if (elements.exportPdfBtn) {
    const exportSource = getPdfExportSource();
    const canExportPdf = Boolean(exportSource && normalizedText(exportSource.markdown));
    elements.exportPdfBtn.disabled = state.pdfExportInProgress || !canExportPdf;
    if (state.rightView === "thinking") {
      elements.exportPdfBtn.title = "Thinking view does not support PDF export yet.";
    } else if (state.rightView === "markdown") {
      elements.exportPdfBtn.title = "Switch right pane to Response (Preview) or Editor (Preview) to export PDF.";
    } else if (!canExportPdf) {
      elements.exportPdfBtn.title = "Nothing to export yet.";
    } else if (state.pdfExportInProgress) {
      elements.exportPdfBtn.title = "Exporting the current right-pane preview as PDF…";
    } else {
      elements.exportPdfBtn.title = "Export the current right-pane preview as PDF via pandoc + xelatex.";
    }
  }
}

function render() {
  if (!state.snapshot) {
    renderStatusLine();
    return;
  }
  ensureSelectedHistoryItem();
  renderEditorMeta();
  if (state.editorHighlightEnabled) {
    scheduleEditorHighlightRender();
  }
  renderResponsePane();
  renderDiagnostics();
  renderFooterMeta();
  updateActionState();
  renderStatusLine();
}

async function fetchSnapshot() {
  const response = await fetch(buildAuthenticatedPath("/api/snapshot"), {
    headers: buildAuthenticatedHeaders(),
  });
  if (!response.ok) {
    const message = response.status === 403
      ? "Studio access expired. Re-run /studio."
      : `Snapshot request failed with ${response.status}`;
    throw new Error(message);
  }
  applySnapshot(await response.json(), { initial: !state.initialSnapshotLoaded });
  render();
}

async function postJson(path, payload = {}) {
  state.busy = true;
  render();
  try {
    const response = await fetch(buildAuthenticatedPath(path), {
      method: "POST",
      headers: buildAuthenticatedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed with ${response.status}`);
    }
    if (data.snapshot) {
      applySnapshot(data.snapshot);
    }
    render();
    restartSnapshotPolling(true);
    return data;
  } finally {
    state.busy = false;
    render();
  }
}

function getSnapshotPollDelayMs() {
  if (typeof document !== "undefined" && document.hidden) {
    return 1200;
  }
  const runState = state.snapshot?.state?.runState ?? "idle";
  if (runState === "running" || runState === "stopping") {
    return 120;
  }
  return 500;
}

function cancelSnapshotPolling() {
  if (!state.snapshotPollTimer) return;
  window.clearTimeout(state.snapshotPollTimer);
  state.snapshotPollTimer = null;
}

function scheduleSnapshotPolling(delayMs = getSnapshotPollDelayMs()) {
  cancelSnapshotPolling();
  state.snapshotPollTimer = window.setTimeout(() => {
    state.snapshotPollTimer = null;
    void pollSnapshotOnce();
  }, Math.max(0, delayMs));
}

function restartSnapshotPolling(immediate = false) {
  scheduleSnapshotPolling(immediate ? 0 : getSnapshotPollDelayMs());
}

async function pollSnapshotOnce() {
  if (state.snapshotPollInFlight) {
    restartSnapshotPolling();
    return;
  }
  state.snapshotPollInFlight = true;
  try {
    await fetchSnapshot();
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.snapshotPollInFlight = false;
    restartSnapshotPolling();
  }
}

function getDerivedUploadSourcePath() {
  if (state.sourcePath || !state.uploadFileName || !state.workingDir) return "";
  return state.workingDir.replace(/\/$/, "") + "/" + state.uploadFileName;
}

function getEffectiveSourcePath() {
  return state.sourcePath || getDerivedUploadSourcePath() || "";
}

function showWorkingDirState(mode) {
  if (!elements.resourceDirBtn || !elements.resourceDirLabel || !elements.resourceDirInputWrap) return;
  const hasFilePath = Boolean(state.sourcePath);
  if (hasFilePath) {
    elements.resourceDirBtn.hidden = true;
    elements.resourceDirLabel.hidden = true;
    elements.resourceDirInputWrap.classList.remove("visible");
    return;
  }
  elements.resourceDirBtn.hidden = mode !== "button";
  elements.resourceDirLabel.hidden = mode !== "label";
  elements.resourceDirInputWrap.classList.toggle("visible", mode === "input");
}

function setEditorText(text, originLabel, options = {}) {
  elements.promptInput.value = text;
  state.editorOriginLabel = originLabel;
  if (Object.prototype.hasOwnProperty.call(options, "sourcePath")) {
    state.sourcePath = options.sourcePath ? String(options.sourcePath) : null;
  }
  if (Object.prototype.hasOwnProperty.call(options, "uploadFileName")) {
    state.uploadFileName = options.uploadFileName ? String(options.uploadFileName) : "";
  }
  if (Object.prototype.hasOwnProperty.call(options, "workingDir")) {
    state.workingDir = options.workingDir ? String(options.workingDir) : "";
    state.workingDirDraft = state.workingDir;
  }
  if (options.language) {
    setEditorLanguage(String(options.language));
  }
  state.lastLoadedIntoEditorNormalized = normalizedText(text);
  scheduleEditorHighlightRender();
  render();
}

function getEditorContextPaths() {
  const sourcePath = getEffectiveSourcePath();
  const baseDir = (!sourcePath && state.workingDir) ? state.workingDir : "";
  return {
    sourcePath,
    baseDir,
  };
}

function describeSourceForAnnotation() {
  const effectivePath = getEffectiveSourcePath();
  if (effectivePath) {
    return `file ${effectivePath.split(/[\\/]/).pop() || effectivePath}`;
  }
  if (/response/i.test(state.editorOriginLabel)) {
    return "last model response";
  }
  return state.editorOriginLabel || "studio editor";
}

function buildAnnotationHeader() {
  let header = "annotated reply below:\n";
  header += `original source: ${describeSourceForAnnotation()}\n`;
  header += "user annotation syntax: [an: note]\n";
  header += "precedence: later messages supersede these annotations unless user explicitly references them\n\n---\n\n";
  return header;
}

function stripAnnotationBoundaryMarker(text) {
  return String(text || "").replace(/\n{0,2}--- end annotations ---\s*$/i, "");
}

function stripAnnotationHeader(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized.toLowerCase().startsWith("annotated reply below:")) {
    return { hadHeader: false, body: normalized };
  }
  const dividerIndex = normalized.indexOf("\n---");
  if (dividerIndex < 0) {
    return { hadHeader: false, body: normalized };
  }
  let cursor = dividerIndex + 4;
  while (cursor < normalized.length && normalized[cursor] === "\n") {
    cursor += 1;
  }
  return {
    hadHeader: true,
    body: stripAnnotationBoundaryMarker(normalized.slice(cursor)),
  };
}

function buildAnnotatedSaveSuggestion() {
  const effectivePath = getEffectiveSourcePath();
  if (effectivePath) {
    const parts = String(effectivePath).split(/[\\/]/);
    const fileName = parts.pop() || "draft.md";
    const dir = parts.length > 0 ? parts.join("/") + "/" : "";
    const stem = fileName.replace(/\.[^.]+$/, "") || "draft";
    return dir + stem + ".annotated.md";
  }
  const rawName = state.uploadFileName || "draft.md";
  const stem = rawName.replace(/\.[^.]+$/, "") || "draft";
  const baseName = `${stem}.annotated.md`;
  if (state.workingDir) {
    return state.workingDir.replace(/\/$/, "") + "/" + baseName;
  }
  return "./" + baseName;
}

function updateAnnotatedReplyHeaderButton() {
  if (!elements.insertHeaderBtn) return;
  const hasHeader = stripAnnotationHeader(elements.promptInput.value).hadHeader;
  elements.insertHeaderBtn.textContent = hasHeader ? "Remove annotated reply header" : "Insert annotated reply header";
}

function buildSuggestedSavePath() {
  const effectivePath = getEffectiveSourcePath();
  if (effectivePath) return effectivePath;
  const ext = preferredExtensionForLanguage(state.editorLanguage);
  const baseName = state.uploadFileName || `draft.${ext}`;
  if (state.workingDir) {
    return state.workingDir.replace(/\/$/, "") + "/" + baseName;
  }
  return "./" + baseName;
}

async function loadGitDiff() {
  try {
    const context = getEditorContextPaths();
    const data = await postJson("/api/git-diff", {
      sourcePath: context.sourcePath || undefined,
      baseDir: context.baseDir || undefined,
    });

    if (!data || data.ok === false) {
      const level = data?.level === "error"
        ? "error"
        : (data?.level === "warning" ? "warning" : "warning");
      setTransientStatus(data?.message || "No git diff available.", level);
      return;
    }

    const label = String(data.label || "git diff").trim() || "git diff";
    const repoRoot = String(data.repoRoot || context.baseDir || "").trim();
    setEditorText(String(data.content || ""), label, {
      sourcePath: null,
      uploadFileName: "",
      workingDir: repoRoot,
      language: "diff",
    });
    setTransientStatus(data.message || "Loaded current git diff into Studio.", "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function loadFileContent(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const language = detectLanguageFromName(file.name || "") || state.editorLanguage;
    const preservedWorkingDir = state.workingDir;
    if (elements.fileInput) {
      elements.fileInput.value = "";
    }
    setEditorText(text, `upload: ${file.name || "file"}`, {
      sourcePath: null,
      uploadFileName: file.name || "",
      workingDir: preservedWorkingDir,
      language,
    });
    setTransientStatus(`Loaded ${file.name || "file"}.`, "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function saveEditorAs() {
  const content = elements.promptInput.value;
  if (!normalizedText(content)) {
    setTransientStatus("Editor is empty. Nothing to save.", "warning");
    return;
  }
  const path = window.prompt("Save editor content as:", buildSuggestedSavePath());
  if (!path) return;
  try {
    const data = await postJson("/api/file/save", { path, content, baseDir: state.workingDir || undefined });
    const language = detectLanguageFromName(data.path || data.label || path) || state.editorLanguage;
    setEditorText(content, data.label || data.path || path, { sourcePath: data.path || null, uploadFileName: "", language, workingDir: "" });
    setTransientStatus(`Saved editor text to ${data.label || data.path || path}.`, "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function saveEditor() {
  const content = elements.promptInput.value;
  if (!normalizedText(content)) {
    setTransientStatus("Editor is empty. Nothing to save.", "warning");
    return;
  }
  const effectivePath = getEffectiveSourcePath();
  if (!effectivePath) {
    setTransientStatus("Save editor requires a file path. Load a file, set a working dir, or use Save editor as…", "warning");
    return;
  }
  try {
    const data = await postJson("/api/file/save", { path: effectivePath, content });
    setEditorText(content, data.label || effectivePath, { sourcePath: data.path || effectivePath, uploadFileName: "" });
    setTransientStatus(`Saved ${data.label || effectivePath}.`, "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function toggleAnnotatedReplyHeader() {
  const stripped = stripAnnotationHeader(elements.promptInput.value);
  if (stripped.hadHeader) {
    setEditorText(stripped.body, state.editorOriginLabel, { sourcePath: state.sourcePath, workingDir: state.workingDir, language: state.editorLanguage });
    setTransientStatus("Removed annotated reply header.", "success");
    return;
  }
  const cleanedBody = stripAnnotationBoundaryMarker(stripped.body);
  const updated = buildAnnotationHeader() + cleanedBody + "\n\n--- end annotations ---\n\n";
  setEditorText(updated, state.editorOriginLabel, { sourcePath: state.sourcePath, workingDir: state.workingDir, language: state.editorLanguage });
  setTransientStatus("Inserted annotated reply header.", "success");
}

function stripAllAnnotations() {
  const content = elements.promptInput.value;
  if (!hasAnnotationMarkers(content)) {
    setTransientStatus("No [an: ...] markers found in editor.", "warning");
    return;
  }
  const confirmed = window.confirm("Remove all [an: ...] markers from editor text? This cannot be undone.");
  if (!confirmed) return;
  const stripped = stripAnnotationMarkers(content);
  setEditorText(stripped, state.editorOriginLabel, { sourcePath: state.sourcePath, workingDir: state.workingDir, language: state.editorLanguage });
  setTransientStatus("Removed annotation markers from editor text.", "success");
}

async function saveAnnotatedCopy() {
  const content = elements.promptInput.value;
  if (!normalizedText(content)) {
    setTransientStatus("Editor is empty. Nothing to save.", "warning");
    return;
  }
  const path = window.prompt("Save annotated editor content as:", buildAnnotatedSaveSuggestion());
  if (!path) return;
  try {
    const data = await postJson("/api/file/save", { path, content, baseDir: state.workingDir || undefined });
    setTransientStatus(`Saved annotated editor text to ${data.label || data.path || path}.`, "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function openWorkingDirEditor() {
  if (state.sourcePath) {
    setTransientStatus("Working dir is only needed for non-file-backed editor content.", "warning");
    return;
  }
  state.workingDirDraft = state.workingDir;
  state.workingDirEditorOpen = true;
  render();
  if (elements.resourceDirInput) {
    elements.resourceDirInput.value = state.workingDirDraft;
    elements.resourceDirInput.focus();
    elements.resourceDirInput.select();
  }
}

function applyWorkingDir() {
  const trimmed = String(state.workingDirDraft || "").trim();
  state.workingDir = trimmed;
  state.workingDirDraft = trimmed;
  state.workingDirEditorOpen = false;
  if (elements.resourceDirInput) {
    elements.resourceDirInput.value = trimmed;
  }
  render();
  setTransientStatus(trimmed ? `Working dir set to ${trimmed}.` : "Working dir cleared.", "success");
}

async function exportRightPanePdf() {
  if (state.pdfExportInProgress) {
    setTransientStatus("PDF export is already in progress.", "warning");
    return;
  }

  const exportSource = getPdfExportSource();
  if (!exportSource) {
    setTransientStatus("Switch right pane to Response (Preview) or Editor (Preview) before exporting PDF.", "warning");
    return;
  }

  state.pdfExportInProgress = true;
  render();
  setTransientStatus("Exporting PDF…", "", 30_000);

  try {
    const response = await fetch(buildAuthenticatedPath("/api/export-pdf"), {
      method: "POST",
      headers: buildAuthenticatedHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(exportSource),
    });

    if (!response.ok) {
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      let message = `PDF export failed with HTTP ${response.status}.`;
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload && typeof payload.error === "string") {
          message = payload.error;
        }
      } else {
        const text = await response.text().catch(() => "");
        if (text && text.trim()) {
          message = text.trim();
        }
      }
      throw new Error(message);
    }

    const warning = String(response.headers.get("x-pi-studio-export-warning") || "").trim();
    const headerFilename = parseContentDispositionFilename(response.headers.get("content-disposition"));
    let downloadName = headerFilename || exportSource.filenameHint || "studio-preview.pdf";
    if (!/\.pdf$/i.test(downloadName)) {
      downloadName += ".pdf";
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = downloadName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    if (warning) {
      setTransientStatus(`Exported PDF with warning: ${warning}`, "warning", 5000);
    } else {
      setTransientStatus(`Exported PDF: ${downloadName}`, "success", 3200);
    }
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error", 5000);
  } finally {
    state.pdfExportInProgress = false;
    render();
  }
}

async function copyText(text, successMessage) {
  await navigator.clipboard.writeText(text);
  setTransientStatus(successMessage, "success");
}

async function requestStopActiveRun(requestKind = getRequestKind(state.snapshot?.activeTurn)) {
  try {
    await postJson("/api/stop");
    setTransientStatus(requestKind === "critique" ? "Stop requested for critique." : "Stop requested.", "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function runOrStop() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  if (snapshot.state.runState === "running") {
    if (getRequestKind(snapshot.activeTurn) === "critique") {
      return;
    }
    await requestStopActiveRun("run");
    return;
  }

  const prompt = normalizedText(prepareEditorTextForSend(elements.promptInput.value));
  if (!prompt) {
    setTransientStatus("Add editor text before running.", "warning");
    return;
  }

  clearTitleAttention();
  try {
    await postJson("/api/run", { prompt });
    setTransientStatus("Running editor text.", "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function critiqueOrStop() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  if (snapshot.state.runState === "running") {
    if (getRequestKind(snapshot.activeTurn) !== "critique") {
      return;
    }
    await requestStopActiveRun("critique");
    return;
  }

  const document = normalizedText(prepareEditorTextForSend(elements.promptInput.value));
  if (!document) {
    setTransientStatus("Add editor text before critique.", "warning");
    return;
  }

  const lens = elements.lensSelect && ["auto", "writing", "code"].includes(elements.lensSelect.value)
    ? elements.lensSelect.value
    : "auto";

  clearTitleAttention();
  try {
    const result = await postJson("/api/critique", { document, lens });
    const resolvedLens = ["writing", "code"].includes(result?.lens) ? result.lens : lens;
    setTransientStatus(`Running critique${resolvedLens === "auto" ? "" : ` (${resolvedLens})`}.`, "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function queueSteering() {
  const prompt = normalizedText(prepareEditorTextForSend(elements.promptInput.value));
  if (!prompt) {
    setTransientStatus("Add editor text before queueing steering.", "warning");
    return;
  }
  clearTitleAttention();
  try {
    await postJson("/api/steer", { prompt });
    setTransientStatus("Queued steering.", "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function selectHistoryIndex(index) {
  const history = getHistory();
  if (!history.length) return;
  const clamped = Math.max(0, Math.min(history.length - 1, index));
  const item = history[clamped];
  if (!item) return;
  state.selectedPromptId = item.localPromptId;
  render();
}

function handleHistoryPrev() {
  const history = getHistory();
  if (!history.length) {
    setTransientStatus("No response history available yet.", "warning");
    return;
  }
  const currentIndex = getSelectedHistoryIndex();
  if (state.followLatest) {
    state.followLatest = false;
    selectHistoryIndex(Math.max(0, history.length - 2));
    setTransientStatus("Viewing previous response.", "success");
    return;
  }
  selectHistoryIndex(currentIndex - 1);
  setTransientStatus("Viewing previous response.", "success");
}

function handleHistoryNext() {
  const history = getHistory();
  if (!history.length) {
    setTransientStatus("No response history available yet.", "warning");
    return;
  }
  if (state.followLatest) return;
  const currentIndex = getSelectedHistoryIndex();
  selectHistoryIndex(currentIndex + 1);
  setTransientStatus("Viewing next response.", "success");
}

function handleHistoryLast() {
  const latest = getLatestHistoryItem();
  if (!latest) {
    setTransientStatus("No response history available yet.", "warning");
    return;
  }
  state.followLatest = true;
  state.selectedPromptId = latest.localPromptId;
  render();
  setTransientStatus("Viewing latest response.", "success");
}

function loadSelectedResponse() {
  const display = state.rightView === "thinking" ? getDisplayedThinking() : getDisplayedResponse();
  const responseText = display?.hasContent ? String(display.markdown || "") : "";
  if (!normalizedText(responseText)) {
    setTransientStatus(state.rightView === "thinking" ? "No thinking available for the selected response." : "No response available yet.", "warning");
    return;
  }
  const originLabel = state.rightView === "thinking"
    ? "assistant thinking"
    : (display.kind === "active" ? "live response" : "selected response");
  setEditorText(responseText, originLabel, { sourcePath: null, uploadFileName: "" });
  setTransientStatus(state.rightView === "thinking" ? "Loaded thinking into editor." : "Loaded response into editor.", "success");
}

function loadSelectedCritiqueNotes() {
  const display = getDisplayedResponse();
  const item = display.kind === "history" ? display.item : null;
  if (!item || !isCritiqueHistoryItem(item) || !isCritiqueResponseMarkdown(item.responseText || "")) {
    setTransientStatus("The selected response is not a structured critique.", "warning");
    return;
  }
  const notes = buildCritiqueNotesMarkdown(item.responseText || "");
  if (!notes) {
    setTransientStatus("No critique notes (Assessment/Critiques) found in the selected response.", "warning");
    return;
  }
  setEditorText(notes, "critique notes", { sourcePath: null, uploadFileName: "" });
  setTransientStatus("Loaded critique notes into editor.", "success");
}

function loadSelectedCritiqueFull() {
  const display = getDisplayedResponse();
  const item = display.kind === "history" ? display.item : null;
  const fullCritique = String(item?.responseText || "");
  if (!item || !isCritiqueHistoryItem(item) || !isCritiqueResponseMarkdown(fullCritique)) {
    setTransientStatus("The selected response is not a structured critique.", "warning");
    return;
  }
  setEditorText(fullCritique, "full critique", { sourcePath: null, uploadFileName: "" });
  setTransientStatus("Loaded full critique into editor.", "success");
}

function loadSelectedPrompt() {
  const item = getSelectedHistoryItem();
  if (!item) {
    setTransientStatus("Prompt unavailable for the selected response.", "warning");
    return;
  }
  const promptSource = item.promptMode === "steer" ? (item.effectivePrompt || item.promptText) : item.promptText;
  if (!normalizedText(promptSource)) {
    setTransientStatus("Prompt unavailable for the selected response.", "warning");
    return;
  }
  setEditorText(promptSource, getHistoryPromptSourceStateLabel(item), { sourcePath: null, uploadFileName: "" });
  setTransientStatus(getHistoryPromptLoadedStatus(item), "success");
}

async function copySelectedResponse() {
  const display = state.rightView === "thinking" ? getDisplayedThinking() : getDisplayedResponse();
  const responseText = display?.hasContent ? String(display.markdown || "") : "";
  if (!normalizedText(responseText)) {
    setTransientStatus(state.rightView === "thinking" ? "No thinking available yet." : "No response available yet.", "warning");
    return;
  }
  try {
    await copyText(
      responseText,
      state.rightView === "thinking"
        ? "Copied thinking text."
        : (display.kind === "active"
            ? (getRequestKind(display.turn) === "critique" ? "Copied live critique preview." : "Copied live response preview.")
            : (isCritiqueDisplay(display) ? "Copied critique text." : "Copied response text.")),
    );
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function toggleDiagnostics() {
  state.diagnosticsOpen = !state.diagnosticsOpen;
  render();
  setTransientStatus(`Diagnostics ${state.diagnosticsOpen ? "shown" : "hidden"}.`, "success", 1400);
}

function handlePromptInputChange() {
  const normalized = normalizedText(elements.promptInput.value);
  if (!state.sourcePath && !state.uploadFileName && normalized !== state.lastLoadedIntoEditorNormalized) {
    state.editorOriginLabel = normalized ? "studio editor draft" : "studio editor";
  }
  if (state.editorHighlightEnabled) {
    scheduleEditorHighlightRender();
  }
  render();
}

function handleFollowLatestChange() {
  state.followLatest = elements.followSelect.value === "on";
  if (state.followLatest) {
    const latest = getLatestHistoryItem();
    state.selectedPromptId = latest?.localPromptId ?? null;
  }
  render();
}

function updatePaneFocusButtons() {
  [
    [elements.leftFocusBtn, "left"],
    [elements.rightFocusBtn, "right"],
  ].forEach(([btn, pane]) => {
    if (!btn) return;
    const isFocusedPane = state.paneFocusTarget === pane;
    const paneName = pane === "right" ? "response" : "editor";
    btn.classList.toggle("is-active", isFocusedPane);
    btn.setAttribute("aria-pressed", isFocusedPane ? "true" : "false");
    btn.textContent = isFocusedPane ? "Exit focus" : "Focus pane";
    btn.title = isFocusedPane
      ? "Return to the two-pane layout. Shortcut: F10 or Cmd/Ctrl+Esc."
      : `Show only the ${paneName} pane. Shortcut: F10 or Cmd/Ctrl+Esc.`;
  });
}

function applyPaneFocusClasses() {
  document.body.classList.remove("pane-focus-left", "pane-focus-right");
  if (state.paneFocusTarget === "left") {
    document.body.classList.add("pane-focus-left");
  } else if (state.paneFocusTarget === "right") {
    document.body.classList.add("pane-focus-right");
  }
  updatePaneFocusButtons();
}

function setActivePane(nextPane) {
  state.activePane = nextPane === "right" ? "right" : "left";
  if (elements.leftPane) elements.leftPane.classList.toggle("pane-active", state.activePane === "left");
  if (elements.rightPane) elements.rightPane.classList.toggle("pane-active", state.activePane === "right");
  if (state.paneFocusTarget !== "off" && state.paneFocusTarget !== state.activePane) {
    state.paneFocusTarget = state.activePane;
    applyPaneFocusClasses();
  }
}

function paneLabel(pane) {
  return pane === "right" ? "Response" : "Editor";
}

function enterPaneFocus(nextPane) {
  const pane = nextPane === "right" ? "right" : "left";
  setActivePane(pane);
  state.paneFocusTarget = pane;
  applyPaneFocusClasses();
  setTransientStatus(`Focus mode: ${paneLabel(pane)} pane.`, "success", 1500);
}

function togglePaneFocus() {
  if (state.paneFocusTarget === state.activePane) {
    state.paneFocusTarget = "off";
    applyPaneFocusClasses();
    setTransientStatus("Focus mode off.", "success", 1200);
    return;
  }
  enterPaneFocus(state.activePane);
}

function exitPaneFocus() {
  if (state.paneFocusTarget === "off") return false;
  state.paneFocusTarget = "off";
  applyPaneFocusClasses();
  setTransientStatus("Focus mode off.", "success", 1200);
  return true;
}

function handleGlobalShortcuts(event) {
  if (event.defaultPrevented || event.isComposing) return;
  const metaEnter = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "Enter";
  const plainEscape = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "Escape";
  const togglePaneShortcut = ((event.metaKey || event.ctrlKey) && event.key === "Escape") || event.key === "F10";

  if (togglePaneShortcut) {
    event.preventDefault();
    togglePaneFocus();
    return;
  }

  if (metaEnter) {
    event.preventDefault();
    if (state.snapshot?.state?.runState === "running" && !elements.queueBtn.disabled) {
      void queueSteering();
      return;
    }
    if (!elements.runBtn.disabled) {
      void runOrStop();
    }
    return;
  }

  if (plainEscape && state.snapshot?.state?.runState === "running") {
    event.preventDefault();
    if (getRequestKind(state.snapshot?.activeTurn) === "critique") {
      void requestStopActiveRun("critique");
    } else {
      void requestStopActiveRun("run");
    }
    return;
  }

  if (plainEscape && exitPaneFocus()) {
    event.preventDefault();
  }
}

function wireEvents() {
  if (elements.saveAsBtn) {
    elements.saveAsBtn.addEventListener("click", () => void saveEditorAs());
  }
  if (elements.saveBtn) {
    elements.saveBtn.addEventListener("click", () => void saveEditor());
  }
  if (elements.fileInput) {
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files && elements.fileInput.files[0];
      if (!file) return;
      void loadFileContent(file);
    });
  }
  if (elements.loadGitDiffBtn) {
    elements.loadGitDiffBtn.addEventListener("click", () => void loadGitDiff());
  }
  if (elements.resourceDirBtn) {
    elements.resourceDirBtn.addEventListener("click", () => openWorkingDirEditor());
  }
  if (elements.resourceDirLabel) {
    elements.resourceDirLabel.addEventListener("click", () => openWorkingDirEditor());
  }
  if (elements.resourceDirInput) {
    elements.resourceDirInput.addEventListener("input", () => {
      state.workingDirDraft = elements.resourceDirInput.value;
    });
    elements.resourceDirInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyWorkingDir();
      } else if (event.key === "Escape") {
        event.preventDefault();
        state.workingDirDraft = state.workingDir;
        state.workingDirEditorOpen = false;
        render();
      }
    });
  }
  if (elements.resourceDirClearBtn) {
    elements.resourceDirClearBtn.addEventListener("click", () => {
      state.workingDir = "";
      state.workingDirDraft = "";
      state.workingDirEditorOpen = false;
      if (elements.resourceDirInput) elements.resourceDirInput.value = "";
      render();
      setTransientStatus("Working dir cleared.", "success");
    });
  }
  if (elements.insertHeaderBtn) {
    elements.insertHeaderBtn.addEventListener("click", () => toggleAnnotatedReplyHeader());
  }
  if (elements.annotationModeSelect) {
    elements.annotationModeSelect.addEventListener("change", () => {
      setAnnotationsEnabled(elements.annotationModeSelect.value !== "off");
      render();
    });
  }
  if (elements.stripAnnotationsBtn) {
    elements.stripAnnotationsBtn.addEventListener("click", () => stripAllAnnotations());
  }
  if (elements.saveAnnotatedBtn) {
    elements.saveAnnotatedBtn.addEventListener("click", () => void saveAnnotatedCopy());
  }
  elements.refreshBtn.addEventListener("click", () => {
    void fetchSnapshot().then(() => {
      setTransientStatus("Refreshed snapshot.", "success", 1200);
    }).catch((error) => {
      setTransientStatus(error instanceof Error ? error.message : String(error), "error");
    });
  });

  elements.diagnosticsBtn.addEventListener("click", () => toggleDiagnostics());
  elements.runBtn.addEventListener("click", () => void runOrStop());
  if (elements.critiqueBtn) {
    elements.critiqueBtn.addEventListener("click", () => void critiqueOrStop());
  }
  elements.queueBtn.addEventListener("click", () => void queueSteering());
  elements.copyDraftBtn.addEventListener("click", () => {
    void copyText(elements.promptInput.value, "Copied editor text.").catch((error) => {
      setTransientStatus(error instanceof Error ? error.message : String(error), "error");
    });
  });
  elements.followSelect.addEventListener("change", () => handleFollowLatestChange());
  if (elements.highlightSelect) {
    elements.highlightSelect.addEventListener("change", () => {
      setEditorHighlightEnabled(elements.highlightSelect.value === "on");
      render();
    });
  }
  if (elements.responseHighlightSelect) {
    elements.responseHighlightSelect.addEventListener("change", () => {
      setResponseHighlightEnabled(elements.responseHighlightSelect.value === "on");
      render();
    });
  }
  if (elements.langSelect) {
    elements.langSelect.addEventListener("change", () => {
      setEditorLanguage(elements.langSelect.value);
      render();
    });
  }
  if (elements.rightViewSelect) {
    elements.rightViewSelect.addEventListener("change", () => {
      state.rightView = elements.rightViewSelect.value === "editor-preview"
        ? "editor-preview"
        : (elements.rightViewSelect.value === "markdown"
            ? "markdown"
            : (elements.rightViewSelect.value === "thinking" ? "thinking" : "preview"));
      state.currentRenderedPreviewKey = "";
      render();
    });
  }
  if (elements.leftPane) {
    elements.leftPane.addEventListener("mousedown", () => setActivePane("left"));
    elements.leftPane.addEventListener("focusin", () => setActivePane("left"));
  }
  if (elements.rightPane) {
    elements.rightPane.addEventListener("mousedown", () => setActivePane("right"));
    elements.rightPane.addEventListener("focusin", () => setActivePane("right"));
  }
  if (elements.leftFocusBtn) {
    elements.leftFocusBtn.addEventListener("click", () => {
      if (state.paneFocusTarget === "left") {
        exitPaneFocus();
        return;
      }
      enterPaneFocus("left");
    });
  }
  if (elements.rightFocusBtn) {
    elements.rightFocusBtn.addEventListener("click", () => {
      if (state.paneFocusTarget === "right") {
        exitPaneFocus();
        return;
      }
      enterPaneFocus("right");
    });
  }
  elements.historyPrevBtn.addEventListener("click", () => handleHistoryPrev());
  elements.historyNextBtn.addEventListener("click", () => handleHistoryNext());
  elements.historyLastBtn.addEventListener("click", () => handleHistoryLast());
  elements.loadResponseBtn.addEventListener("click", () => loadSelectedResponse());
  if (elements.loadCritiqueNotesBtn) {
    elements.loadCritiqueNotesBtn.addEventListener("click", () => loadSelectedCritiqueNotes());
  }
  if (elements.loadCritiqueFullBtn) {
    elements.loadCritiqueFullBtn.addEventListener("click", () => loadSelectedCritiqueFull());
  }
  elements.loadHistoryPromptBtn.addEventListener("click", () => loadSelectedPrompt());
  elements.copyResponseBtn.addEventListener("click", () => void copySelectedResponse());
  if (elements.exportPdfBtn) {
    elements.exportPdfBtn.addEventListener("click", () => void exportRightPanePdf());
  }
  elements.promptInput.addEventListener("input", () => handlePromptInputChange());
  elements.promptInput.addEventListener("scroll", () => syncEditorHighlightScroll());
  elements.promptInput.addEventListener("keyup", () => syncEditorHighlightScroll());
  elements.promptInput.addEventListener("mouseup", () => syncEditorHighlightScroll());
  window.addEventListener("resize", () => syncEditorHighlightScroll());
  window.addEventListener("keydown", handleGlobalShortcuts);
}

async function main() {
  populateLanguageOptions();
  setEditorLanguage(readStoredEditorLanguage() || state.editorLanguage);
  setAnnotationsEnabled(readStoredToggle(ANNOTATION_MODE_STORAGE_KEY) ?? true);
  setEditorHighlightEnabled(readStoredToggle(EDITOR_HIGHLIGHT_STORAGE_KEY) ?? true);
  setResponseHighlightEnabled(readStoredToggle(RESPONSE_HIGHLIGHT_STORAGE_KEY) ?? true);
  setActivePane("left");
  applyPaneFocusClasses();
  wireEvents();
  await fetchSnapshot();
  restartSnapshotPolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      state.windowHasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
      clearTitleAttention();
    }
    restartSnapshotPolling(!document.hidden);
  });
  window.addEventListener("focus", () => {
    state.windowHasFocus = true;
    clearTitleAttention();
    restartSnapshotPolling(true);
  });
  window.addEventListener("blur", () => {
    state.windowHasFocus = false;
  });
  window.addEventListener("beforeunload", () => {
    stopTitleAttentionTimer();
  });
}

void main().catch((error) => {
  setTransientStatus(error instanceof Error ? error.message : String(error), "error", 4000);
});
