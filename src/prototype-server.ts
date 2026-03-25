import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createOpencodeStudioHost, type OpencodeStudioHostTelemetryEvent } from "./host-opencode.js";
import { buildPrototypeThemeStylesheet, readPrototypeThemeDescriptor, type PrototypeThemeDescriptor } from "./prototype-theme.js";
import type { StudioHostCapabilities, StudioHostHistoryItem, StudioHostState } from "./studio-host-types.js";

export type PrototypeServerOptions = {
  directory: string;
  baseUrl?: string;
  sessionId?: string;
  title?: string;
  host: string;
  port: number;
};

type PrototypeTurnSnapshot = {
  localPromptId: string;
  chainIndex: number;
  promptMode: StudioHostHistoryItem["promptMode"];
  promptSteeringCount: number;
  promptText: string;
  submittedAt: number;
  backendBusyAt?: number;
  firstAssistantMessageAt?: number;
  firstOutputTextAt?: number;
  latestAssistantMessageId?: string;
  latestPartType?: string;
  outputPreview: string;
  completedAt?: number;
  responseText?: string | null;
  responseError?: string;
};

type PrototypeTurnRecord = PrototypeTurnSnapshot & {
  latestTextParts: Map<string, string>;
};

type PrototypeModelSnapshot = {
  providerID: string;
  modelID: string;
  agent?: string;
  source: "user" | "assistant";
  messageId: string;
  at: number;
};

type PrototypeThemeSnapshot = {
  raw: string | null;
  preference: PrototypeThemeDescriptor["preference"];
  source: PrototypeThemeDescriptor["source"];
  family: string | null;
};

export type PrototypeSnapshot = {
  state: StudioHostState;
  capabilities: StudioHostCapabilities;
  history: StudioHostHistoryItem[];
  logs: Array<{ at: number; line: string }>;
  activeTurn: PrototypeTurnSnapshot | null;
  lastCompletedTurn: PrototypeTurnSnapshot | null;
  currentModel: PrototypeModelSnapshot | null;
  launchContext: {
    directory: string;
    baseUrl: string | null;
    theme: PrototypeThemeSnapshot;
  };
  serverStartedAt: number;
  now: number;
};

export type PrototypeServerInstance = {
  url: string;
  baseUrl: string;
  token: string;
  host: string;
  port: number;
  getSnapshot(): PrototypeSnapshot;
  getState(): StudioHostState;
  stop(): Promise<void>;
};

const STATIC_DIR = resolve(fileURLToPath(new URL("../static", import.meta.url)));
const MAX_LOG_LINES = 200;
const REQUEST_BODY_MAX_BYTES = 1_000_000;
const PROTOTYPE_TOKEN_HEADER = "x-pi-studio-token";

function createPrototypeAccessToken(): string {
  return randomUUID();
}

function buildPrototypeAccessUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}/?token=${encodeURIComponent(token)}`;
}

function readPrototypeRequestToken(request: IncomingMessage, url: URL): string {
  const headerValue = request.headers[PROTOTYPE_TOKEN_HEADER];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  return url.searchParams.get("token")?.trim() ?? "";
}

function hasValidPrototypeToken(request: IncomingMessage, url: URL, token: string): boolean {
  return readPrototypeRequestToken(request, url) === token;
}

function respondInvalidPrototypeToken(response: ServerResponse): void {
  sendJson(response, 403, { error: "Invalid or expired studio token. Re-run /studio." });
}

async function buildPrototypeHtml(theme: PrototypeThemeDescriptor, token: string): Promise<string> {
  const templatePath = resolve(STATIC_DIR, "prototype.html");
  const template = await readFile(templatePath, "utf8");
  const bootJson = JSON.stringify({
    token,
    theme: {
      raw: theme.raw,
      preference: theme.preference,
      source: theme.source,
      family: theme.family,
    },
  }).replace(/</g, "\\u003c");
  const themeStyles = buildPrototypeThemeStylesheet(theme);
  const stylesheetHref = `/static/prototype.css?token=${encodeURIComponent(token)}`;
  const scriptHref = `/static/prototype.js?token=${encodeURIComponent(token)}`;

  return template
    .replace(
      '<link rel="stylesheet" href="/static/prototype.css" />',
      `<link rel="stylesheet" href="${stylesheetHref}" />\n    <style id="pi-studio-opencode-theme">\n${themeStyles}\n    </style>\n    <script>window.__PI_STUDIO_OPENCODE_BOOT__ = ${bootJson};</script>`,
    )
    .replace(
      '<script type="module" src="/static/prototype.js"></script>',
      `<script type="module" src="${scriptHref}"></script>`,
    );
}

function expandHome(input: string): string {
  if (!input) return input;
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function resolvePrototypeBaseDir(sourcePath: string | undefined, resourceDir: string | undefined, fallbackCwd: string): string {
  const source = typeof sourcePath === "string" ? sourcePath.trim() : "";
  if (source) {
    const expanded = expandHome(source);
    return dirname(isAbsolute(expanded) ? expanded : resolve(fallbackCwd, expanded));
  }

  const resource = typeof resourceDir === "string" ? resourceDir.trim() : "";
  if (resource) {
    const expanded = expandHome(resource);
    return isAbsolute(expanded) ? expanded : resolve(fallbackCwd, expanded);
  }

  return fallbackCwd;
}

function resolvePrototypeUserPath(targetPath: string, baseDir: string | undefined, fallbackCwd: string): string {
  const trimmed = String(targetPath || "").trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }

  const expanded = expandHome(trimmed);
  if (isAbsolute(expanded)) {
    return expanded;
  }

  const base = typeof baseDir === "string" && baseDir.trim()
    ? resolvePrototypeBaseDir(undefined, baseDir, fallbackCwd)
    : fallbackCwd;
  return resolve(base, expanded);
}

async function resolvePrototypePandocWorkingDir(baseDir: string | undefined): Promise<string | undefined> {
  const normalized = typeof baseDir === "string" ? baseDir.trim() : "";
  if (!normalized) return undefined;
  try {
    return (await stat(normalized)).isDirectory() ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function parseArgs(argv: string[]): PrototypeServerOptions {
  const options: PrototypeServerOptions = {
    directory: process.cwd(),
    host: "127.0.0.1",
    port: 4312,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--directory" && next) {
      options.directory = next;
      i += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--session" && next) {
      options.sessionId = next;
      i += 1;
      continue;
    }
    if (arg === "--title" && next) {
      options.title = next;
      i += 1;
      continue;
    }
    if (arg === "--host" && next) {
      options.host = next;
      i += 1;
      continue;
    }
    if (arg === "--port" && next) {
      options.port = Number.parseInt(next, 10);
      if (!Number.isFinite(options.port) || options.port < 0) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsageAndExit();
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsageAndExit(): never {
  console.log(`Usage: npm run prototype -- [options]

Options:
  --directory <path>    Project directory / working directory
  --base-url <url>      Use an existing opencode server
  --session <id>        Reuse an existing session
  --title <title>       Title for a newly created session
  --host <host>         HTTP bind host (default: 127.0.0.1)
  --port <port>         HTTP bind port (default: 4312; use 0 for auto-select)
`);
  process.exit(0);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response: ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

function contentTypeForPath(pathname: string): string {
  switch (extname(pathname)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const relativePath = pathname.replace(/^\/static\//, "");
  const filePath = resolve(STATIC_DIR, relativePath);
  if (!filePath.startsWith(STATIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypeForPath(filePath));
    response.setHeader("Cache-Control", "no-store");
    response.end(content);
  } catch (error) {
    sendText(response, 404, error instanceof Error ? error.message : "Not found");
  }
}

function normalizePrompt(payload: { prompt?: unknown }): string {
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    throw new Error("Prompt text is required.");
  }
  return prompt;
}

function createTurnRecord(item: StudioHostHistoryItem): PrototypeTurnRecord {
  return {
    localPromptId: item.localPromptId,
    chainIndex: item.chainIndex,
    promptMode: item.promptMode,
    promptSteeringCount: item.promptSteeringCount,
    promptText: item.promptText,
    submittedAt: item.submittedAt,
    outputPreview: "",
    latestTextParts: new Map<string, string>(),
  };
}

function snapshotTurn(turn: PrototypeTurnRecord | null): PrototypeTurnSnapshot | null {
  if (!turn) return null;
  return {
    localPromptId: turn.localPromptId,
    chainIndex: turn.chainIndex,
    promptMode: turn.promptMode,
    promptSteeringCount: turn.promptSteeringCount,
    promptText: turn.promptText,
    submittedAt: turn.submittedAt,
    backendBusyAt: turn.backendBusyAt,
    firstAssistantMessageAt: turn.firstAssistantMessageAt,
    firstOutputTextAt: turn.firstOutputTextAt,
    latestAssistantMessageId: turn.latestAssistantMessageId,
    latestPartType: turn.latestPartType,
    outputPreview: turn.outputPreview,
    completedAt: turn.completedAt,
    responseText: turn.responseText,
    responseError: turn.responseError,
  };
}

function isLikelyMathExpression(expr: string): boolean {
  const content = expr.trim();
  if (content.length === 0) return false;

  if (/\\[a-zA-Z]+/.test(content)) return true;
  if (/[0-9]/.test(content)) return true;
  if (/[=+\-*/^_<>≤≥±×÷]/u.test(content)) return true;
  if (/[{}]/.test(content)) return true;
  if (/[α-ωΑ-Ω]/u.test(content)) return true;
  if (/^[A-Za-z]$/.test(content)) return true;
  if (/^[A-Za-z][A-Za-z\s'".,:;!?-]*[A-Za-z]$/.test(content)) return false;

  return false;
}

function collapseDisplayMathContent(expr: string): string {
  let content = expr.trim();
  if (/\\begin\{[^}]+\}|\\end\{[^}]+\}/.test(content)) {
    return content;
  }
  if (content.includes("\\\\") || content.includes("\n")) {
    content = content.replace(/\\\\\s*/g, " ");
    content = content.replace(/\s*\n\s*/g, " ");
    content = content.replace(/\s{2,}/g, " ").trim();
  }
  return content;
}

function normalizeMathDelimitersInSegment(markdown: string): string {
  let normalized = markdown.replace(/\$\s*\\\(([\s\S]*?)\\\)\s*\$/g, (match, expr: string) => {
    if (!isLikelyMathExpression(expr)) return match;
    const content = expr.trim();
    return content.length > 0 ? `\\(${content}\\)` : "\\(\\)";
  });

  normalized = normalized.replace(/\$\s*\\\[\s*([\s\S]*?)\s*\\\]\s*\$/g, (match, expr: string) => {
    if (!isLikelyMathExpression(expr)) return match;
    const content = collapseDisplayMathContent(expr);
    return content.length > 0 ? `\\[${content}\\]` : "\\[\\]";
  });

  normalized = normalized.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (match, expr: string) => {
    if (!isLikelyMathExpression(expr)) return `[${expr.trim()}]`;
    const content = collapseDisplayMathContent(expr);
    return content.length > 0 ? `\\[${content}\\]` : "\\[\\]";
  });

  normalized = normalized.replace(/\\\(([\s\S]*?)\\\)/g, (match, expr: string) => {
    if (!isLikelyMathExpression(expr)) return `(${expr})`;
    const content = expr.trim();
    return content.length > 0 ? `\\(${content}\\)` : "\\(\\)";
  });

  return normalized;
}

function normalizeMathDelimiters(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let plainBuffer: string[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;

  const flushPlain = () => {
    if (plainBuffer.length === 0) return;
    out.push(normalizeMathDelimitersInSegment(plainBuffer.join("\n")));
    plainBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const markerChar = marker[0] as "`" | "~";
      const markerLength = marker.length;

      if (!inFence) {
        flushPlain();
        inFence = true;
        fenceChar = markerChar;
        fenceLength = markerLength;
        out.push(line);
        continue;
      }

      if (fenceChar === markerChar && markerLength >= fenceLength) {
        inFence = false;
        fenceChar = undefined;
        fenceLength = 0;
      }

      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
    } else {
      plainBuffer.push(line);
    }
  }

  flushPlain();
  return out.join("\n");
}

function normalizeObsidianImages(markdown: string): string {
  return markdown
    .replace(/!\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_m, path, alt) => `![${alt}](<${path}>)`)
    .replace(/!\[\[([^\]]+)\]\]/g, (_m, path) => `![](<${path}>)`);
}

function stripPrototypeMarkdownHtmlCommentsInSegment(markdown: string): string {
  const source = String(markdown ?? "");
  let out = "";
  let i = 0;
  let codeSpanFenceLength = 0;
  let inHtmlComment = false;

  while (i < source.length) {
    if (inHtmlComment) {
      if (source.startsWith("-->", i)) {
        inHtmlComment = false;
        i += 3;
        continue;
      }
      const ch = source[i]!;
      if (ch === "\n" || ch === "\r") out += ch;
      i += 1;
      continue;
    }

    if (codeSpanFenceLength > 0) {
      const fence = "`".repeat(codeSpanFenceLength);
      if (source.startsWith(fence, i)) {
        out += fence;
        i += codeSpanFenceLength;
        codeSpanFenceLength = 0;
        continue;
      }
      out += source[i]!;
      i += 1;
      continue;
    }

    const backtickMatch = source.slice(i).match(/^`+/);
    if (backtickMatch) {
      const fence = backtickMatch[0]!;
      codeSpanFenceLength = fence.length;
      out += fence;
      i += fence.length;
      continue;
    }

    if (source.startsWith("<!--", i)) {
      inHtmlComment = true;
      i += 4;
      continue;
    }

    out += source[i]!;
    i += 1;
  }

  return out;
}

function stripPrototypeMarkdownHtmlComments(markdown: string): string {
  const lines = String(markdown ?? "").split("\n");
  const out: string[] = [];
  let plainBuffer: string[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;

  const flushPlain = () => {
    if (plainBuffer.length === 0) return;
    out.push(stripPrototypeMarkdownHtmlCommentsInSegment(plainBuffer.join("\n")));
    plainBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const markerChar = marker[0] as "`" | "~";
      const markerLength = marker.length;

      if (!inFence) {
        flushPlain();
        inFence = true;
        fenceChar = markerChar;
        fenceLength = markerLength;
        out.push(line);
        continue;
      }

      if (fenceChar === markerChar && markerLength >= fenceLength) {
        inFence = false;
        fenceChar = undefined;
        fenceLength = 0;
      }

      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
    } else {
      plainBuffer.push(line);
    }
  }

  flushPlain();
  return out.join("\n");
}

const PROTOTYPE_PREVIEW_PAGE_BREAK_SENTINEL_PREFIX = "PI_STUDIO_PAGE_BREAK__";

function replacePrototypePreviewPageBreakCommands(markdown: string): string {
  const lines = String(markdown ?? "").split("\n");
  const out: string[] = [];
  let plainBuffer: string[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;

  const flushPlain = () => {
    if (plainBuffer.length === 0) return;
    out.push(
      plainBuffer.map((line) => {
        const match = line.trim().match(/^\\(newpage|pagebreak|clearpage)(?:\s*\[[^\]]*\])?\s*$/i);
        if (!match) return line;
        const command = match[1]!.toLowerCase();
        return `${PROTOTYPE_PREVIEW_PAGE_BREAK_SENTINEL_PREFIX}${command.toUpperCase()}__`;
      }).join("\n"),
    );
    plainBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const markerChar = marker[0] as "`" | "~";
      const markerLength = marker.length;

      if (!inFence) {
        flushPlain();
        inFence = true;
        fenceChar = markerChar;
        fenceLength = markerLength;
        out.push(line);
        continue;
      }

      if (fenceChar === markerChar && markerLength >= fenceLength) {
        inFence = false;
        fenceChar = undefined;
        fenceLength = 0;
      }

      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
    } else {
      plainBuffer.push(line);
    }
  }

  flushPlain();
  return out.join("\n");
}

function escapePrototypeHtmlText(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decoratePrototypePreviewPageBreakHtml(html: string): string {
  return String(html ?? "").replace(
    new RegExp(`<p>${PROTOTYPE_PREVIEW_PAGE_BREAK_SENTINEL_PREFIX}(NEWPAGE|PAGEBREAK|CLEARPAGE)__<\\/p>`, "gi"),
    (_match, command: string) => {
      const normalized = String(command || "").toLowerCase();
      const label = normalized === "clearpage" ? "Clear page" : "Page break";
      return `<div class="studio-page-break" data-page-break-kind="${normalized}"><span class="studio-page-break-rule" aria-hidden="true"></span><span class="studio-page-break-label">${escapePrototypeHtmlText(label)}</span><span class="studio-page-break-rule" aria-hidden="true"></span></div>`;
    },
  );
}

function stripMathMlAnnotationTags(html: string): string {
  return html
    .replace(/<annotation-xml\b[\s\S]*?<\/annotation-xml>/gi, "")
    .replace(/<annotation\b[\s\S]*?<\/annotation>/gi, "");
}

async function renderPrototypeMarkdownWithPandoc(markdown: string, resourcePath?: string): Promise<string> {
  const pandocCommand = process.env.PANDOC_PATH?.trim() || "pandoc";
  const isLatex = /\\documentclass\b|\\begin\{document\}/.test(markdown);
  const markdownWithoutHtmlComments = isLatex ? String(markdown || "") : stripPrototypeMarkdownHtmlComments(String(markdown || ""));
  const markdownWithPreviewPageBreaks = isLatex ? markdownWithoutHtmlComments : replacePrototypePreviewPageBreakCommands(markdownWithoutHtmlComments);
  const inputFormat = isLatex
    ? "latex"
    : "markdown+lists_without_preceding_blankline-blank_before_blockquote-blank_before_header+tex_math_dollars+tex_math_single_backslash+tex_math_double_backslash+autolink_bare_uris-raw_html";
  const args = ["-f", inputFormat, "-t", "html5", "--mathml", "--wrap=none"];
  if (resourcePath) {
    args.push(`--resource-path=${resourcePath}`);
    args.push("--embed-resources", "--standalone");
  }
  const normalizedMarkdown = isLatex
    ? markdownWithPreviewPageBreaks
    : normalizeObsidianImages(normalizeMathDelimiters(markdownWithPreviewPageBreaks));
  const pandocWorkingDir = await resolvePrototypePandocWorkingDir(resourcePath);

  return await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(pandocCommand, args, { stdio: ["pipe", "pipe", "pipe"], cwd: pandocWorkingDir });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };

    const succeed = (html: string) => {
      if (settled) return;
      settled = true;
      resolvePromise(html);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.once("error", (error) => {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "ENOENT") {
        fail(new Error("pandoc was not found. Install pandoc or set PANDOC_PATH to the pandoc binary."));
        return;
      }
      fail(error);
    });

    child.once("close", (code) => {
      if (settled) return;
      if (code === 0) {
        let renderedHtml = Buffer.concat(stdoutChunks).toString("utf-8");
        if (resourcePath) {
          const bodyMatch = renderedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          if (bodyMatch) {
            renderedHtml = bodyMatch[1] ?? renderedHtml;
          }
        }
        if (!isLatex) {
          renderedHtml = decoratePrototypePreviewPageBreakHtml(renderedHtml);
        }
        succeed(stripMathMlAnnotationTags(renderedHtml));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      fail(new Error(`pandoc failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
    });

    child.stdin.end(normalizedMarkdown);
  });
}

export async function startPrototypeServer(options: PrototypeServerOptions): Promise<PrototypeServerInstance> {
  const serverStartedAt = Date.now();
  const accessToken = createPrototypeAccessToken();
  const theme = await readPrototypeThemeDescriptor();
  const logLines: Array<{ at: number; line: string }> = [];
  let activeTurn: PrototypeTurnRecord | null = null;
  let lastCompletedTurn: PrototypeTurnRecord | null = null;
  let currentModel: PrototypeModelSnapshot | null = null;
  let listenHost = options.host;
  let listenPort = options.port;
  let stopped = false;

  const updateCurrentModel = (input: {
    providerID?: string;
    modelID?: string;
    agent?: string;
    source: "user" | "assistant";
    messageId: string;
    at: number;
  }): void => {
    if (!input.providerID || !input.modelID) return;
    currentModel = {
      providerID: input.providerID,
      modelID: input.modelID,
      agent: input.agent,
      source: input.source,
      messageId: input.messageId,
      at: input.at,
    };
  };

  const handleTelemetry = (event: OpencodeStudioHostTelemetryEvent): void => {
    if (event.type === "submission.dispatched") {
      activeTurn = createTurnRecord(event.submission);
      return;
    }

    if (event.type === "backend.status") {
      if (activeTurn && event.status === "busy" && !activeTurn.backendBusyAt) {
        activeTurn.backendBusyAt = event.at;
      }
      return;
    }

    if (event.type === "user.message.updated") {
      updateCurrentModel({
        providerID: event.providerID,
        modelID: event.modelID,
        agent: event.agent,
        source: "user",
        messageId: event.messageId,
        at: event.at,
      });
      return;
    }

    if (event.type === "assistant.message.updated") {
      updateCurrentModel({
        providerID: event.providerID,
        modelID: event.modelID,
        agent: event.agent,
        source: "assistant",
        messageId: event.messageId,
        at: event.at,
      });
      if (!activeTurn) return;
      if (!activeTurn.firstAssistantMessageAt) {
        activeTurn.firstAssistantMessageAt = event.at;
      }
      activeTurn.latestAssistantMessageId = event.messageId;
      return;
    }

    if (event.type === "assistant.part.updated") {
      if (!activeTurn) return;
      activeTurn.latestAssistantMessageId = event.messageId;
      activeTurn.latestPartType = event.partType;
      if (event.partType === "text" && typeof event.text === "string") {
        activeTurn.latestTextParts.set(event.partId, event.text);
        activeTurn.outputPreview = Array.from(activeTurn.latestTextParts.values()).join("\n\n").trim();
        if (activeTurn.outputPreview && !activeTurn.firstOutputTextAt) {
          activeTurn.firstOutputTextAt = event.at;
        }
      }
      return;
    }

    if (event.type === "assistant.part.delta") {
      if (!activeTurn) return;
      if (event.field !== "text") return;
      if (event.partType && event.partType !== "text") return;
      const prior = activeTurn.latestTextParts.get(event.partId) ?? "";
      activeTurn.latestTextParts.set(event.partId, `${prior}${event.delta}`);
      activeTurn.outputPreview = Array.from(activeTurn.latestTextParts.values()).join("\n\n").trim();
      activeTurn.latestAssistantMessageId = event.messageId;
      activeTurn.latestPartType = event.partType ?? activeTurn.latestPartType;
      if (event.delta && !activeTurn.firstOutputTextAt) {
        activeTurn.firstOutputTextAt = event.at;
      }
      return;
    }

    if (event.type === "submission.completed") {
      const completed = activeTurn && activeTurn.localPromptId === event.historyItem.localPromptId
        ? activeTurn
        : createTurnRecord(event.historyItem);
      completed.completedAt = event.historyItem.completedAt ?? event.at;
      completed.responseText = event.historyItem.responseText;
      completed.responseError = event.historyItem.responseError;
      if (typeof event.historyItem.responseText === "string" && event.historyItem.responseText.trim()) {
        completed.outputPreview = event.historyItem.responseText;
      }
      lastCompletedTurn = completed;
      activeTurn = null;
    }
  };

  const host = await createOpencodeStudioHost({
    directory: options.directory,
    baseUrl: options.baseUrl,
    sessionId: options.sessionId,
    title: options.title,
    eventLogger: (line) => {
      logLines.push({ at: Date.now(), line });
      if (logLines.length > MAX_LOG_LINES) {
        logLines.splice(0, logLines.length - MAX_LOG_LINES);
      }
      console.log(line);
    },
    telemetryListener: handleTelemetry,
  });

  let currentState = host.getState();
  const capabilities = host.getCapabilities();
  const unsubscribe = host.subscribe((state) => {
    currentState = state;
  });

  function buildSnapshot(): PrototypeSnapshot {
    return {
      state: currentState,
      capabilities,
      history: host.getHistory(),
      logs: logLines.slice(-80),
      activeTurn: snapshotTurn(activeTurn),
      lastCompletedTurn: snapshotTurn(lastCompletedTurn),
      currentModel,
      launchContext: {
        directory: options.directory,
        baseUrl: options.baseUrl ?? null,
        theme: {
          raw: theme.raw,
          preference: theme.preference,
          source: theme.source,
          family: theme.family,
        },
      },
      serverStartedAt,
      now: Date.now(),
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${listenHost}:${listenPort}`}`);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        if (!hasValidPrototypeToken(request, url, accessToken)) {
          respondInvalidPrototypeToken(response);
          return;
        }
        response.setHeader("Cache-Control", "no-store");
        sendText(response, 200, await buildPrototypeHtml(theme, accessToken), "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/static/")) {
        if (!hasValidPrototypeToken(request, url, accessToken)) {
          respondInvalidPrototypeToken(response);
          return;
        }
        await serveStatic(response, url.pathname);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        if (!hasValidPrototypeToken(request, url, accessToken)) {
          respondInvalidPrototypeToken(response);
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        sendJson(response, 200, buildSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/file/load") {
        const payload = await readJsonBody<{ path?: string; baseDir?: string }>(request);
        const targetPath = typeof payload.path === "string" ? payload.path : "";
        const baseDir = typeof payload.baseDir === "string" ? payload.baseDir : undefined;
        const resolvedPath = resolvePrototypeUserPath(targetPath, baseDir, options.directory);
        const content = await readFile(resolvedPath, "utf8");
        sendJson(response, 200, {
          ok: true,
          path: resolvedPath,
          label: basename(resolvedPath),
          content,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/file/save") {
        const payload = await readJsonBody<{ path?: string; content?: string; baseDir?: string }>(request);
        const targetPath = typeof payload.path === "string" ? payload.path : "";
        const content = typeof payload.content === "string" ? payload.content : "";
        const baseDir = typeof payload.baseDir === "string" ? payload.baseDir : undefined;
        if (!content.trim()) {
          throw new Error("Nothing to save.");
        }
        const resolvedPath = resolvePrototypeUserPath(targetPath, baseDir, options.directory);
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, content, "utf8");
        sendJson(response, 200, {
          ok: true,
          path: resolvedPath,
          label: basename(resolvedPath),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/render-preview") {
        const payload = await readJsonBody<{ markdown?: string; sourcePath?: string; resourceDir?: string }>(request);
        const markdown = typeof payload.markdown === "string" ? payload.markdown : "";
        if (Buffer.byteLength(markdown, "utf8") > REQUEST_BODY_MAX_BYTES) {
          sendJson(response, 413, { error: `Preview text exceeds ${REQUEST_BODY_MAX_BYTES} bytes.` });
          return;
        }
        const sourcePath = typeof payload.sourcePath === "string" ? payload.sourcePath : "";
        const resourceDir = typeof payload.resourceDir === "string" ? payload.resourceDir : "";
        const resourcePath = resolvePrototypeBaseDir(sourcePath || undefined, resourceDir || undefined, options.directory);
        const html = await renderPrototypeMarkdownWithPandoc(markdown, resourcePath);
        sendJson(response, 200, { ok: true, html, renderer: "pandoc" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/run") {
        const payload = await readJsonBody<{ prompt?: string }>(request);
        await host.startRun(normalizePrompt(payload));
        sendJson(response, 200, { ok: true, snapshot: buildSnapshot() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/steer") {
        const payload = await readJsonBody<{ prompt?: string }>(request);
        await host.queueSteer(normalizePrompt(payload));
        sendJson(response, 200, { ok: true, snapshot: buildSnapshot() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/stop") {
        await host.stop();
        sendJson(response, 200, { ok: true, snapshot: buildSnapshot() });
        return;
      }

      sendJson(response, 404, { error: `Unknown route: ${request.method ?? "GET"} ${url.pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message, snapshot: buildSnapshot() });
    }
  });

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    await host.close();
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  };

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (address && typeof address !== "string") {
    const info = address as AddressInfo;
    listenPort = info.port;
    listenHost = info.address;
  }

  const baseUrl = `http://${listenHost}:${listenPort}`;

  return {
    url: buildPrototypeAccessUrl(listenHost, listenPort, accessToken),
    baseUrl,
    token: accessToken,
    host: listenHost,
    port: listenPort,
    getSnapshot: buildSnapshot,
    getState: () => currentState,
    stop,
  };
}

async function runPrototypeCli(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const instance = await startPrototypeServer(options);

  const shutdown = async (): Promise<void> => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await instance.stop();
  };

  const onSignal = (): void => {
    void shutdown().finally(() => process.exit(0));
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.log(`Prototype ready at ${instance.url}`);
  console.log(`Session: ${instance.getState().sessionId ?? "(pending)"}`);
  console.log(`Working directory: ${options.directory}`);
}

const isPrototypeServerDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isPrototypeServerDirectRun) {
  void runPrototypeCli().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
