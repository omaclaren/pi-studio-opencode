const BRAILLE_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const state = {
  snapshot: null,
  selectedPromptId: null,
  busy: false,
  followLatest: true,
  diagnosticsOpen: false,
  rightView: "preview",
  editorOriginLabel: "studio editor",
  sourcePath: null,
  workingDir: "",
  editorHighlightEnabled: true,
  editorLanguage: "markdown",
  editorHighlightRenderRaf: null,
  lastLoadedIntoEditorNormalized: "",
  transientStatus: null,
  transientStatusTimer: null,
  spinnerTimer: null,
  spinnerFrameIndex: 0,
  responsePreviewRenderNonce: 0,
  responsePreviewTimer: null,
  currentRenderedPreviewKey: "",
  pendingResponseScrollReset: false,
  lastResponseIdentityKey: "",
};

const MATHJAX_CDN_URL = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
const MATHJAX_UNAVAILABLE_MESSAGE = "Math fallback unavailable. Some unsupported equations may remain as raw TeX.";
const MATHJAX_RENDER_FAIL_MESSAGE = "Math fallback could not render some unsupported equations.";
let mathJaxPromise = null;

const EDITOR_HIGHLIGHT_MAX_CHARS = 100_000;
const EDITOR_HIGHLIGHT_STORAGE_KEY = "studioPrototype.editorHighlightEnabled";
const EDITOR_LANGUAGE_STORAGE_KEY = "studioPrototype.editorLanguage";
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
const SUPPORTED_LANGUAGES = Object.keys(LANG_EXT_MAP);

const elements = {
  saveAsBtn: document.getElementById("saveAsBtn"),
  saveBtn: document.getElementById("saveBtn"),
  loadFileBtn: document.getElementById("loadFileBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  diagnosticsBtn: document.getElementById("diagnosticsBtn"),
  sourceBadge: document.getElementById("sourceBadge"),
  resourceDirBtn: document.getElementById("resourceDirBtn"),
  resourceDirLabel: document.getElementById("resourceDirLabel"),
  syncBadge: document.getElementById("syncBadge"),
  queueBadge: document.getElementById("queueBadge"),
  composerStatusBadge: document.getElementById("composerStatusBadge"),
  backendStatusBadge: document.getElementById("backendStatusBadge"),
  historyCountBadge: document.getElementById("historyCountBadge"),
  highlightSelect: document.getElementById("highlightSelect"),
  langSelect: document.getElementById("langSelect"),
  sourceHighlight: document.getElementById("sourceHighlight"),
  promptInput: document.getElementById("promptInput"),
  rightViewSelect: document.getElementById("rightViewSelect"),
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
  loadHistoryPromptBtn: document.getElementById("loadHistoryPromptBtn"),
  copyResponseBtn: document.getElementById("copyResponseBtn"),
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
  footerMetaText: document.getElementById("footerMetaText"),
};

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

function formatModel(snapshot) {
  const model = snapshot?.currentModel;
  if (!model || !model.providerID || !model.modelID) return "-";
  return `${model.providerID}/${model.modelID}`;
}

function formatSessionLabel(snapshot) {
  const sessionTitle = String(snapshot?.state?.sessionTitle || "").trim();
  if (!sessionTitle) return "";
  if (/^Studio host\b/i.test(sessionTitle)) return "";
  if (sessionTitle === "π Studio" || sessionTitle === "Studio") return "";
  return sessionTitle;
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
    out += wrapHighlight("hl-annotation", token);
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
    });
  }

  return buildPreviewErrorHtml("Preview sanitizer unavailable. Showing plain markdown.", markdown);
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
    response = await fetch("/api/render-preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        markdown: String(markdown || ""),
        sourcePath: state.sourcePath || "",
        resourceDir: (!state.sourcePath && state.workingDir) ? state.workingDir : "",
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

function prepareEditorTextForPreview(text) {
  return String(text || "");
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

function getPreviewSource() {
  if (state.rightView === "editor-preview") {
    const markdown = prepareEditorTextForPreview(elements.promptInput.value || "");
    const latest = getLatestHistoryItem();
    const latestTime = formatReferenceTime(latest?.completedAt ?? latest?.submittedAt ?? 0);
    const suffix = latest
      ? (latestTime ? ` · response updated ${latestTime}` : " · response available")
      : "";
    return {
      mode: "editor-preview",
      markdown,
      emptyMessage: "Editor is empty.",
      key: `editor-preview\u0000${markdown}`,
      referenceLabel: `Previewing: editor text${suffix}`,
      previewWarning: "",
    };
  }

  const display = getDisplayedResponse();
  const responseId = display.kind === "history"
    ? display.item?.localPromptId || "none"
    : (display.kind === "active" ? display.turn?.localPromptId || "active" : "none");
  return {
    mode: "preview",
    markdown: display.markdown,
    emptyMessage: display.text,
    key: `preview\u0000${display.kind}\u0000${responseId}\u0000${display.markdown}\u0000${display.previewWarning || ""}`,
    referenceLabel: getResponseReferenceLabel(display),
    previewWarning: display.previewWarning || "",
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
    const renderedHtml = await renderMarkdownWithPandoc(source.markdown);
    if (nonce !== state.responsePreviewRenderNonce || state.rightView !== source.mode) return;
    finishPreviewRender(elements.responseView);
    setResponseViewHtml(sanitizeRenderedHtml(renderedHtml, source.markdown));
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
  return turn.promptMode === "run"
    ? `chain ${turn.chainIndex} · run`
    : `chain ${turn.chainIndex} · steer ${turn.promptSteeringCount}`;
}

function buildResponseDisplayText(item) {
  if (!item) return "No response yet. Run editor text to generate a response.";
  const responseText = String(item.responseText || "");
  if (item.responseError) {
    return responseText.trim()
      ? `error: ${item.responseError}\n\n${responseText}`
      : `error: ${item.responseError}`;
  }
  return responseText.trim() ? responseText : "(empty response)";
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
    return time
      ? `Response history ${selectedLabel} · assistant response · ${time}`
      : `Response history ${selectedLabel} · assistant response`;
  }
  if (display.kind === "active" && display.turn) {
    const time = formatReferenceTime(display.turn.firstOutputTextAt ?? display.turn.firstAssistantMessageAt ?? display.turn.submittedAt ?? 0);
    return time
      ? `Assistant response in progress · ${time}`
      : "Assistant response in progress";
  }
  return "Latest response: none";
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
      text: "Waiting for the active turn to produce a response.",
      markdown: "",
      hasContent: false,
      turn: activeTurn,
      previewWarning: "",
    };
  }

  return {
    kind: "empty",
    text: "No response yet. Run editor text to generate a response.",
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
      itemTitle.textContent = item.promptMode === "run" ? "Run" : `Steer ${item.promptSteeringCount}`;

      const time = document.createElement("span");
      time.className = "meta";
      time.textContent = formatAbsoluteTime(item.submittedAt);

      topRow.append(itemTitle, time);

      const badges = document.createElement("div");
      badges.className = "badges";
      for (const [text, className] of [
        [item.promptMode, item.promptMode],
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
  const display = getDisplayedResponse();
  updatePendingResponseScrollReset(display);

  if (elements.rightViewSelect) {
    elements.rightViewSelect.value = state.rightView;
  }

  const selected = history.length && selectedIndex >= 0 ? selectedIndex + 1 : 0;
  elements.historyIndexBadge.textContent = `History: ${selected}/${history.length}`;

  if (state.rightView === "markdown") {
    cancelScheduledResponsePreviewRender();
    finishPreviewRender(elements.responseView);
    state.responsePreviewRenderNonce += 1;
    state.currentRenderedPreviewKey = `raw\u0000${display.kind}\u0000${display.markdown || ""}\u0000${display.text}`;
    setResponseViewHtml(buildPlainMarkdownHtml(display.text));
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
  const display = getDisplayedResponse();
  const editorTextNormalized = normalizedText(elements.promptInput.value);
  const displayedResponseNormalized = display?.hasContent ? normalizedText(display.markdown) : "";
  const inSync = Boolean(displayedResponseNormalized) && editorTextNormalized === displayedResponseNormalized;

  elements.sourceBadge.textContent = `Editor origin: ${state.editorOriginLabel}`;
  if (elements.resourceDirBtn) {
    elements.resourceDirBtn.hidden = Boolean(state.sourcePath);
  }
  if (elements.resourceDirLabel) {
    elements.resourceDirLabel.hidden = Boolean(state.sourcePath) || !state.workingDir;
    elements.resourceDirLabel.textContent = state.workingDir ? `Working dir: ${state.workingDir}` : "";
  }
  elements.queueBadge.textContent = `Queue: ${snapshot?.state?.queueLength ?? 0}`;
  elements.composerStatusBadge.textContent = `Run state: ${snapshot?.state?.runState ?? "-"}`;
  elements.backendStatusBadge.textContent = `Backend: ${snapshot?.state?.lastBackendStatus ?? "-"}`;
  elements.historyCountBadge.textContent = `History: ${history.length && selectedIndex >= 0 ? selectedIndex + 1 : 0}/${history.length}`;
  elements.syncBadge.hidden = !inSync;
  elements.syncBadge.classList.toggle("sync", inSync);
  if (elements.highlightSelect) {
    elements.highlightSelect.value = state.editorHighlightEnabled ? "on" : "off";
  }
  if (elements.langSelect) {
    elements.langSelect.value = state.editorLanguage;
  }
  if (elements.sourceHighlight) {
    elements.sourceHighlight.hidden = !state.editorHighlightEnabled;
  }
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
    return { message: "Connecting · Studio script starting…", level: "", spinning: true };
  }
  if (snapshot.state.lastError) {
    return { message: `Error · ${snapshot.state.lastError}`, level: "error", spinning: false };
  }
  if (state.busy) {
    return { message: "Studio: sending request…", level: "", spinning: true };
  }
  if (snapshot.state.runState === "stopping") {
    return { message: "Studio: stopping current run…", level: "warning", spinning: true };
  }
  if (snapshot.state.runState === "running") {
    const activeTurn = snapshot.activeTurn;
    const elapsed = activeTurn ? formatRelativeDuration(activeTurn.submittedAt, snapshot.now) : "-";
    const action = activeTurn
      ? (activeTurn.promptMode === "run" ? "running editor text" : `queueing steering ${activeTurn.promptSteeringCount}`)
      : "waiting for queued steering";
    const suffix = elapsed !== "-" ? ` · ${elapsed}` : "";
    return { message: `Studio: ${action}…${suffix}`, level: "", spinning: true };
  }
  return {
    message: "Ready · Edit, run, queue steering, or inspect response history.",
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

  const model = formatModel(state.snapshot);
  if (model && model !== "-") {
    parts.push(`Model: ${model}`);
  }

  const sessionLabel = formatSessionLabel(state.snapshot);
  if (sessionLabel) {
    parts.push(`Session: ${sessionLabel}`);
  }

  parts.push(`History: ${selected}/${history.length}`);
  parts.push(`Queue: ${queue}`);

  elements.footerMetaText.textContent = parts.join(" · ");
}

function updateActionState() {
  const snapshot = state.snapshot;
  const hasPrompt = Boolean(normalizedText(elements.promptInput.value));
  const runState = snapshot?.state?.runState ?? "idle";
  const running = runState === "running" || runState === "stopping";
  const selectedItem = getSelectedHistoryItem();
  const displayed = getDisplayedResponse();
  const history = getHistory();
  const selectedIndex = getSelectedHistoryIndex();
  const displayedResponseText = displayed?.hasContent ? normalizedText(displayed.markdown) : "";

  elements.runBtn.textContent = runState === "stopping" ? "Stopping…" : (running ? "Stop" : "Run editor text");
  elements.runBtn.classList.toggle("request-stop-active", running);
  elements.runBtn.disabled = !snapshot || state.busy || (!running && !hasPrompt) || runState === "stopping";

  elements.queueBtn.disabled = !snapshot || state.busy || runState !== "running" || !hasPrompt;
  elements.copyDraftBtn.disabled = !hasPrompt;
  if (elements.saveAsBtn) elements.saveAsBtn.disabled = state.busy || !hasPrompt;
  if (elements.saveBtn) elements.saveBtn.disabled = state.busy || !hasPrompt || !state.sourcePath;
  if (elements.loadFileBtn) elements.loadFileBtn.disabled = state.busy;
  if (elements.resourceDirBtn) elements.resourceDirBtn.disabled = state.busy || Boolean(state.sourcePath);
  if (elements.highlightSelect) elements.highlightSelect.disabled = state.busy;
  if (elements.langSelect) elements.langSelect.disabled = state.busy;

  elements.followSelect.value = state.followLatest ? "on" : "off";
  elements.historyPrevBtn.disabled = history.length === 0 || (!state.followLatest && selectedIndex <= 0) || (state.followLatest && history.length <= 1);
  elements.historyNextBtn.disabled = history.length === 0 || state.followLatest || selectedIndex < 0 || selectedIndex >= history.length - 1;
  elements.historyLastBtn.disabled = history.length === 0 || (state.followLatest && selectedIndex === history.length - 1);

  elements.loadResponseBtn.disabled = state.busy || !displayedResponseText;
  elements.loadResponseBtn.textContent = "Load response into editor";
  if (!selectedItem) {
    elements.loadHistoryPromptBtn.disabled = true;
    elements.loadHistoryPromptBtn.textContent = "Load response prompt into editor";
  } else if (selectedItem.promptMode === "steer") {
    elements.loadHistoryPromptBtn.disabled = state.busy || !normalizedText(selectedItem.effectivePrompt);
    elements.loadHistoryPromptBtn.textContent = "Load effective prompt into editor";
  } else {
    elements.loadHistoryPromptBtn.disabled = state.busy || !normalizedText(selectedItem.promptText);
    elements.loadHistoryPromptBtn.textContent = "Load run prompt into editor";
  }

  elements.copyResponseBtn.disabled = !displayedResponseText;
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
  const response = await fetch("/api/snapshot");
  if (!response.ok) {
    throw new Error(`Snapshot request failed with ${response.status}`);
  }
  state.snapshot = await response.json();
  render();
}

async function postJson(path, payload = {}) {
  state.busy = true;
  render();
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed with ${response.status}`);
    }
    if (data.snapshot) {
      state.snapshot = data.snapshot;
    }
    render();
    return data;
  } finally {
    state.busy = false;
    render();
  }
}

function setEditorText(text, originLabel, options = {}) {
  elements.promptInput.value = text;
  state.editorOriginLabel = originLabel;
  if (Object.prototype.hasOwnProperty.call(options, "sourcePath")) {
    state.sourcePath = options.sourcePath ? String(options.sourcePath) : null;
  }
  if (Object.prototype.hasOwnProperty.call(options, "workingDir")) {
    state.workingDir = options.workingDir ? String(options.workingDir) : "";
  }
  if (options.language) {
    setEditorLanguage(String(options.language));
  }
  state.lastLoadedIntoEditorNormalized = normalizedText(text);
  scheduleEditorHighlightRender();
  render();
}

function buildSuggestedSavePath() {
  if (state.sourcePath) return state.sourcePath;
  const ext = preferredExtensionForLanguage(state.editorLanguage);
  const baseName = `draft.${ext}`;
  if (state.workingDir) {
    return state.workingDir.replace(/\/$/, "") + "/" + baseName;
  }
  return "./" + baseName;
}

async function loadFileContent() {
  const suggested = state.sourcePath || (state.workingDir ? state.workingDir.replace(/\/$/, "") + "/" : "./");
  const path = window.prompt("Load file content from:", suggested);
  if (!path) return;
  try {
    const data = await postJson("/api/file/load", { path, baseDir: state.workingDir || undefined });
    const language = detectLanguageFromName(data.path || data.label || "") || state.editorLanguage;
    setEditorText(data.content || "", data.label || data.path || path, { sourcePath: data.path || null, language, workingDir: "" });
    setTransientStatus(`Loaded ${data.label || data.path || path}.`, "success");
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
    setEditorText(content, data.label || data.path || path, { sourcePath: data.path || null, language, workingDir: "" });
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
  if (!state.sourcePath) {
    setTransientStatus("Save editor requires a file path. Use Save editor as… or load a file first.", "warning");
    return;
  }
  try {
    const data = await postJson("/api/file/save", { path: state.sourcePath, content });
    setEditorText(content, data.label || state.sourcePath, { sourcePath: data.path || state.sourcePath });
    setTransientStatus(`Saved ${data.label || state.sourcePath}.`, "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function chooseWorkingDir() {
  if (state.sourcePath) {
    setTransientStatus("Working dir is only needed for non-file-backed editor content.", "warning");
    return;
  }
  const suggested = state.workingDir || "./";
  const result = window.prompt("Set working directory for preview/resource resolution (leave blank to clear):", suggested);
  if (result === null) return;
  const trimmed = result.trim();
  state.workingDir = trimmed;
  render();
  setTransientStatus(trimmed ? `Working dir set to ${trimmed}.` : "Working dir cleared.", "success");
}

async function copyText(text, successMessage) {
  await navigator.clipboard.writeText(text);
  setTransientStatus(successMessage, "success");
}

async function runOrStop() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  if (snapshot.state.runState === "running") {
    try {
      await postJson("/api/stop");
      setTransientStatus("Stop requested.", "success");
    } catch (error) {
      setTransientStatus(error instanceof Error ? error.message : String(error), "error");
    }
    return;
  }

  const prompt = normalizedText(elements.promptInput.value);
  if (!prompt) {
    setTransientStatus("Add editor text before running.", "warning");
    return;
  }

  try {
    await postJson("/api/run", { prompt });
    setTransientStatus("Running editor text.", "success");
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function queueSteering() {
  const prompt = normalizedText(elements.promptInput.value);
  if (!prompt) {
    setTransientStatus("Add editor text before queueing steering.", "warning");
    return;
  }
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
  const display = getDisplayedResponse();
  const responseText = display?.hasContent ? String(display.markdown || "") : "";
  if (!normalizedText(responseText)) {
    setTransientStatus("No response available yet.", "warning");
    return;
  }
  const originLabel = display.kind === "active" ? "live response" : "selected response";
  setEditorText(responseText, originLabel, { sourcePath: null });
  setTransientStatus("Loaded response into editor.", "success");
}

function loadSelectedPrompt() {
  const item = getSelectedHistoryItem();
  if (!item) {
    setTransientStatus("Prompt unavailable for the selected response.", "warning");
    return;
  }
  if (item.promptMode === "steer") {
    setEditorText(item.effectivePrompt || item.promptText, "effective prompt", { sourcePath: null });
    setTransientStatus("Loaded effective prompt into editor.", "success");
    return;
  }
  setEditorText(item.promptText, "run prompt", { sourcePath: null });
  setTransientStatus("Loaded run prompt into editor.", "success");
}

async function copySelectedResponse() {
  const display = getDisplayedResponse();
  const responseText = display?.hasContent ? String(display.markdown || "") : "";
  if (!normalizedText(responseText)) {
    setTransientStatus("No response available yet.", "warning");
    return;
  }
  try {
    await copyText(responseText, display.kind === "active" ? "Copied live response preview." : "Copied response text.");
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
  if (!state.sourcePath && normalized !== state.lastLoadedIntoEditorNormalized) {
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

function handleGlobalShortcuts(event) {
  if (event.defaultPrevented || event.isComposing) return;
  const metaEnter = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "Enter";
  const plainEscape = !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape";

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

  if (plainEscape && state.snapshot?.state?.runState === "running" && !elements.runBtn.disabled) {
    event.preventDefault();
    void runOrStop();
  }
}

function wireEvents() {
  if (elements.saveAsBtn) {
    elements.saveAsBtn.addEventListener("click", () => void saveEditorAs());
  }
  if (elements.saveBtn) {
    elements.saveBtn.addEventListener("click", () => void saveEditor());
  }
  if (elements.loadFileBtn) {
    elements.loadFileBtn.addEventListener("click", () => void loadFileContent());
  }
  if (elements.resourceDirBtn) {
    elements.resourceDirBtn.addEventListener("click", () => chooseWorkingDir());
  }
  if (elements.resourceDirLabel) {
    elements.resourceDirLabel.addEventListener("click", () => chooseWorkingDir());
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
        : (elements.rightViewSelect.value === "markdown" ? "markdown" : "preview");
      state.currentRenderedPreviewKey = "";
      render();
    });
  }
  elements.historyPrevBtn.addEventListener("click", () => handleHistoryPrev());
  elements.historyNextBtn.addEventListener("click", () => handleHistoryNext());
  elements.historyLastBtn.addEventListener("click", () => handleHistoryLast());
  elements.loadResponseBtn.addEventListener("click", () => loadSelectedResponse());
  elements.loadHistoryPromptBtn.addEventListener("click", () => loadSelectedPrompt());
  elements.copyResponseBtn.addEventListener("click", () => void copySelectedResponse());
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
  setEditorHighlightEnabled(readStoredToggle(EDITOR_HIGHLIGHT_STORAGE_KEY) ?? true);
  wireEvents();
  await fetchSnapshot();
  window.setInterval(() => {
    void fetchSnapshot().catch((error) => {
      setTransientStatus(error instanceof Error ? error.message : String(error), "error");
    });
  }, 500);
}

void main().catch((error) => {
  setTransientStatus(error instanceof Error ? error.message : String(error), "error", 4000);
});
