import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

export const PROTOTYPE_PDF_EXPORT_MAX_CHARS = 400_000;

export type PrototypePdfRenderOptions = {
  isLatex?: boolean;
  resourcePath?: string;
  editorPdfLanguage?: string;
};

type PrototypePdfCalloutBlock = {
  kind: "note" | "tip" | "warning" | "important" | "caution";
  markerId: number;
  content: string;
};

type PrototypePdfAlignedImageBlock = {
  align: "center" | "right";
  markerId: number;
};

function expandHome(input: string): string {
  if (!input) return input;
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

async function resolvePrototypePdfWorkingDir(baseDir: string | undefined): Promise<string | undefined> {
  const normalized = typeof baseDir === "string" ? baseDir.trim() : "";
  if (!normalized) return undefined;
  try {
    return (await stat(normalized)).isDirectory() ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function stripPrototypeLatexComments(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  return lines.map((line) => {
    let out = "";
    let backslashRun = 0;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === "%" && backslashRun % 2 === 0) break;
      out += ch;
      if (ch === "\\") backslashRun += 1;
      else backslashRun = 0;
    }
    return out;
  }).join("\n");
}

function collectPrototypeLatexBibliographyCandidates(markdown: string): string[] {
  const stripped = stripPrototypeLatexComments(markdown);
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (raw: string) => {
    let candidate = String(raw ?? "").trim().replace(/^file:/i, "").replace(/^['"]|['"]$/g, "");
    if (!candidate) return;
    if (!/\.[A-Za-z0-9]+$/.test(candidate)) candidate += ".bib";
    if (seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  for (const match of stripped.matchAll(/\\bibliography\s*\{([^}]+)\}/g)) {
    const rawList = match[1] ?? "";
    for (const part of rawList.split(",")) {
      pushCandidate(part);
    }
  }

  for (const match of stripped.matchAll(/\\addbibresource(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    pushCandidate(match[1] ?? "");
  }

  return candidates;
}

async function resolvePrototypeLatexBibliographyPaths(markdown: string, baseDir: string | undefined): Promise<string[]> {
  const workingDir = await resolvePrototypePdfWorkingDir(baseDir);
  if (!workingDir) return [];
  const resolvedPaths: string[] = [];
  const seen = new Set<string>();

  for (const candidate of collectPrototypeLatexBibliographyCandidates(markdown)) {
    const expanded = expandHome(candidate);
    const resolvedPath = isAbsolute(expanded) ? expanded : resolve(workingDir, expanded);
    try {
      if (!(await stat(resolvedPath)).isFile()) continue;
      if (seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);
      resolvedPaths.push(resolvedPath);
    } catch {
      // Ignore missing bibliography files; pandoc can still render the document body.
    }
  }

  return resolvedPaths;
}

async function buildPrototypePandocBibliographyArgs(markdown: string, isLatex: boolean | undefined, baseDir: string | undefined): Promise<string[]> {
  if (!isLatex) return [];
  const bibliographyPaths = await resolvePrototypeLatexBibliographyPaths(markdown, baseDir);
  if (bibliographyPaths.length === 0) return [];
  return [
    "--citeproc",
    "-M",
    "reference-section-title=References",
    ...bibliographyPaths.flatMap((path) => ["--bibliography", path]),
  ];
}

function normalizePrototypeEditorLanguage(language: string | undefined): string | undefined {
  const trimmed = typeof language === "string" ? language.trim().toLowerCase() : "";
  if (!trimmed) return undefined;
  if (trimmed === "patch" || trimmed === "udiff") return "diff";
  return trimmed;
}

function parsePrototypeSingleFencedCodeBlock(markdown: string): { info: string; content: string } | null {
  const trimmed = markdown.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  if (lines.length < 2) return null;

  const openingLine = (lines[0] ?? "").trim();
  const openingMatch = openingLine.match(/^(`{3,}|~{3,})([^\n]*)$/);
  if (!openingMatch) return null;
  const openingFence = openingMatch[1]!;
  const info = (openingMatch[2] ?? "").trim();

  const closingLine = (lines[lines.length - 1] ?? "").trim();
  const closingMatch = closingLine.match(/^(`{3,}|~{3,})\s*$/);
  if (!closingMatch) return null;
  const closingFence = closingMatch[1]!;
  if (closingFence[0] !== openingFence[0] || closingFence.length < openingFence.length) {
    return null;
  }

  return {
    info,
    content: lines.slice(1, -1).join("\n"),
  };
}

function isPrototypeSingleFencedCodeBlock(markdown: string): boolean {
  return parsePrototypeSingleFencedCodeBlock(markdown) !== null;
}

function getLongestPrototypeFenceRun(text: string, fenceChar: "`" | "~"): number {
  const regex = fenceChar === "`" ? /`+/g : /~+/g;
  let max = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    max = Math.max(max, match[0].length);
  }
  return max;
}

function wrapPrototypeCodeAsMarkdown(code: string, language?: string): string {
  const source = String(code ?? "").replace(/\r\n/g, "\n").trimEnd();
  const lang = normalizePrototypeEditorLanguage(language) ?? "";
  const maxBackticks = getLongestPrototypeFenceRun(source, "`");
  const maxTildes = getLongestPrototypeFenceRun(source, "~");

  let markerChar: "`" | "~" = "`";
  if (maxBackticks === 0 && maxTildes === 0) {
    markerChar = "`";
  } else if (maxTildes < maxBackticks) {
    markerChar = "~";
  } else if (maxBackticks < maxTildes) {
    markerChar = "`";
  } else {
    markerChar = maxBackticks > 0 ? "~" : "`";
  }

  const markerLength = Math.max(3, (markerChar === "`" ? maxBackticks : maxTildes) + 1);
  const marker = markerChar.repeat(markerLength);
  return `${marker}${lang}\n${source}\n${marker}`;
}

function isLikelyRawPrototypeGitDiff(markdown: string): boolean {
  const text = String(markdown ?? "");
  if (!text.trim() || isPrototypeSingleFencedCodeBlock(text)) return false;
  if (/^diff --git\s/m.test(text)) return true;
  if (/^@@\s.+\s@@/m.test(text) && /^---\s/m.test(text) && /^\+\+\+\s/m.test(text)) return true;
  return false;
}

export function inferPrototypePdfLanguage(markdown: string, editorLanguage?: string): string | undefined {
  const normalizedEditorLanguage = normalizePrototypeEditorLanguage(editorLanguage);
  if (normalizedEditorLanguage) return normalizedEditorLanguage;

  const fenced = parsePrototypeSingleFencedCodeBlock(markdown);
  if (fenced) {
    const fencedLanguage = normalizePrototypeEditorLanguage(fenced.info.split(/\s+/)[0] ?? "");
    if (fencedLanguage) return fencedLanguage;
  }

  if (isLikelyRawPrototypeGitDiff(markdown)) return "diff";
  return undefined;
}

function escapePrototypePdfLatexText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}%#$&_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\s{2,}/g, " ");
}

function replacePrototypeAnnotationMarkersForPdfInSegment(text: string): string {
  return String(text ?? "")
    .replace(/\[an:\s*([^\]]+?)\]/gi, (_match, markerText: string) => {
      const cleaned = escapePrototypePdfLatexText(markerText);
      if (!cleaned) return "";
      return `\\studioannotation{${cleaned}}`;
    })
    .replace(/\{\[\}\s*an:\s*([\s\S]*?)\s*\{\]\}/gi, (_match, markerText: string) => {
      const cleaned = escapePrototypePdfLatexText(markerText);
      if (!cleaned) return "";
      return `\\studioannotation{${cleaned}}`;
    });
}

function replacePrototypeAnnotationMarkersForPdf(markdown: string): string {
  const lines = String(markdown ?? "").split("\n");
  const out: string[] = [];
  let plainBuffer: string[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;

  const flushPlain = () => {
    if (plainBuffer.length === 0) return;
    out.push(replacePrototypeAnnotationMarkersForPdfInSegment(plainBuffer.join("\n")));
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

function parsePrototypeFencedDivOpenLine(line: string): { markerLength: number; info: string } | null {
  const trimmed = String(line ?? "").trim();
  const match = trimmed.match(/^(:{3,})(.+)$/);
  if (!match) return null;
  const info = String(match[2] ?? "").trim();
  if (!info) return null;
  return {
    markerLength: match[1]!.length,
    info,
  };
}

function parsePrototypePdfCalloutStartLine(line: string): { markerLength: number; kind: PrototypePdfCalloutBlock["kind"] } | null {
  const open = parsePrototypeFencedDivOpenLine(line);
  if (!open) return null;
  const kindMatch = open.info.match(/(?:^|[\s{])\.callout-(note|tip|warning|important|caution)(?=[\s}]|$)/i);
  if (!kindMatch) return null;
  return {
    markerLength: open.markerLength,
    kind: kindMatch[1]!.toLowerCase() as PrototypePdfCalloutBlock["kind"],
  };
}

function preprocessPrototypeMarkdownCalloutsForPdf(markdown: string): { markdown: string; blocks: PrototypePdfCalloutBlock[] } {
  const lines = String(markdown ?? "").split("\n");
  const out: string[] = [];
  const blocks: PrototypePdfCalloutBlock[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;
  let markerId = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const markerChar = marker[0] as "`" | "~";
      const markerLength = marker.length;
      if (!inFence) {
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
      continue;
    }

    const calloutStart = parsePrototypePdfCalloutStartLine(line);
    if (!calloutStart) {
      out.push(line);
      continue;
    }

    const contentLines: string[] = [];
    let innerInFence = false;
    let innerFenceChar: "`" | "~" | undefined;
    let innerFenceLength = 0;
    let nestedDivDepth = 0;
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const innerLine = lines[j] ?? "";
      const innerTrimmed = innerLine.trimStart();
      const innerFenceMatch = innerTrimmed.match(/^(`{3,}|~{3,})/);
      if (innerFenceMatch) {
        const marker = innerFenceMatch[1]!;
        const markerChar = marker[0] as "`" | "~";
        const markerLength = marker.length;
        if (!innerInFence) {
          innerInFence = true;
          innerFenceChar = markerChar;
          innerFenceLength = markerLength;
          contentLines.push(innerLine);
          continue;
        }
        if (innerFenceChar === markerChar && markerLength >= innerFenceLength) {
          innerInFence = false;
          innerFenceChar = undefined;
          innerFenceLength = 0;
        }
        contentLines.push(innerLine);
        continue;
      }
      if (!innerInFence) {
        const nestedOpen = parsePrototypeFencedDivOpenLine(innerLine);
        if (nestedOpen) {
          nestedDivDepth += 1;
          contentLines.push(innerLine);
          continue;
        }
        if (/^:{3,}\s*$/.test(innerLine.trim())) {
          if (nestedDivDepth > 0) {
            nestedDivDepth -= 1;
            contentLines.push(innerLine);
            continue;
          }
          closed = true;
          break;
        }
      }
      contentLines.push(innerLine);
    }

    if (!closed) {
      out.push(line);
      out.push(...contentLines);
      i = j - 1;
      continue;
    }

    const block: PrototypePdfCalloutBlock = {
      kind: calloutStart.kind,
      markerId: markerId += 1,
      content: contentLines.join("\n").trim(),
    };
    blocks.push(block);
    out.push(`PISTUDIOPDFCALLOUTSTART${block.kind.toUpperCase()}${block.markerId}`);
    if (block.content) out.push(block.content);
    out.push(`PISTUDIOPDFCALLOUTEND${block.kind.toUpperCase()}${block.markerId}`);
    i = j;
  }

  return { markdown: out.join("\n"), blocks };
}

function preprocessPrototypeMarkdownImageAlignmentForPdf(markdown: string): { markdown: string; blocks: PrototypePdfAlignedImageBlock[] } {
  const lines = String(markdown ?? "").split("\n");
  const out: string[] = [];
  const blocks: PrototypePdfAlignedImageBlock[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;
  let markerId = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const markerChar = marker[0] as "`" | "~";
      const markerLength = marker.length;
      if (!inFence) {
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
      continue;
    }

    const imageMatch = line.trim().match(/^!\[[^\]]*\]\((?:<[^>]+>|[^)]+)\)(\{[^}]*\})\s*$/);
    if (!imageMatch) {
      out.push(line);
      continue;
    }
    const attrs = imageMatch[1] ?? "";
    const alignMatch = attrs.match(/(?:^|\s)fig-align\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s}]+))/i);
    const alignValue = String(alignMatch?.[1] ?? alignMatch?.[2] ?? alignMatch?.[3] ?? "").trim().toLowerCase();
    if (alignValue !== "center" && alignValue !== "right") {
      out.push(line);
      continue;
    }
    const block: PrototypePdfAlignedImageBlock = {
      align: alignValue as PrototypePdfAlignedImageBlock["align"],
      markerId: markerId += 1,
    };
    blocks.push(block);
    out.push(`PISTUDIOPDFALIGNSTART${block.align.toUpperCase()}${block.markerId}`);
    out.push(line);
    out.push(`PISTUDIOPDFALIGNEND${block.align.toUpperCase()}${block.markerId}`);
  }

  return { markdown: out.join("\n"), blocks };
}

function replacePrototypePdfCalloutBlocksInGeneratedLatex(latex: string, blocks: PrototypePdfCalloutBlock[]): string {
  if (blocks.length === 0) return latex;
  let transformed = String(latex ?? "");
  for (const block of blocks) {
    const startMarker = `PISTUDIOPDFCALLOUTSTART${block.kind.toUpperCase()}${block.markerId}`;
    const endMarker = `PISTUDIOPDFCALLOUTEND${block.kind.toUpperCase()}${block.markerId}`;
    const startIndex = transformed.indexOf(startMarker);
    if (startIndex < 0) continue;
    const endIndex = transformed.indexOf(endMarker, startIndex + startMarker.length);
    if (endIndex < 0) continue;
    const inner = transformed.slice(startIndex + startMarker.length, endIndex).trim();
    const label = block.kind === "note"
      ? "Note"
      : block.kind === "tip"
        ? "Tip"
        : block.kind === "warning"
          ? "Warning"
          : block.kind === "important"
            ? "Important"
            : "Caution";
    const replacement = `\\begin{studiocallout}{${label}}\n${inner}\n\\end{studiocallout}`;
    transformed = transformed.slice(0, startIndex) + replacement + transformed.slice(endIndex + endMarker.length);
  }
  return transformed;
}

function replacePrototypePdfAlignedImageBlocksInGeneratedLatex(latex: string, blocks: PrototypePdfAlignedImageBlock[]): string {
  if (blocks.length === 0) return latex;
  let transformed = String(latex ?? "");
  for (const block of blocks) {
    const startMarker = `PISTUDIOPDFALIGNSTART${block.align.toUpperCase()}${block.markerId}`;
    const endMarker = `PISTUDIOPDFALIGNEND${block.align.toUpperCase()}${block.markerId}`;
    const startIndex = transformed.indexOf(startMarker);
    if (startIndex < 0) continue;
    const endIndex = transformed.indexOf(endMarker, startIndex + startMarker.length);
    if (endIndex < 0) continue;
    const inner = transformed.slice(startIndex + startMarker.length, endIndex).trim();
    const env = block.align === "right" ? "flushright" : "center";
    const replacement = `\\begin{${env}}\n${inner}\n\\end{${env}}`;
    transformed = transformed.slice(0, startIndex) + replacement + transformed.slice(endIndex + endMarker.length);
  }
  return transformed;
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

function buildPrototypePdfPreamble(): string {
  return `\\usepackage{titlesec}
\\titleformat{\\section}{\\Large\\bfseries\\sffamily}{}{0pt}{}[\\vspace{3pt}\\titlerule\\vspace{12pt}]
\\titleformat{\\subsection}{\\large\\bfseries\\sffamily}{}{0pt}{}
\\titleformat{\\subsubsection}{\\normalsize\\bfseries\\sffamily}{}{0pt}{}
\\titlespacing*{\\section}{0pt}{1.5ex plus 0.5ex minus 0.2ex}{1ex plus 0.2ex}
\\titlespacing*{\\subsection}{0pt}{1.2ex plus 0.4ex minus 0.2ex}{0.6ex plus 0.1ex}
\\usepackage{xcolor}
\\definecolor{StudioAnnotationBg}{HTML}{EAF3FF}
\\definecolor{StudioAnnotationBorder}{HTML}{8CB8FF}
\\definecolor{StudioAnnotationText}{HTML}{1F5FBF}
\\newcommand{\\studioannotation}[1]{\\begingroup\\setlength{\\fboxsep}{1.5pt}\\fcolorbox{StudioAnnotationBorder}{StudioAnnotationBg}{\\textcolor{StudioAnnotationText}{\\sffamily\\footnotesize\\strut #1}}\\endgroup}
\\newenvironment{studiocallout}[1]{\\par\\vspace{0.22em}\\noindent\\begingroup\\color{StudioAnnotationBorder}\\hrule height 0.45pt\\color{black}\\vspace{0.08em}\\noindent{\\sffamily\\bfseries\\textcolor{StudioAnnotationText}{#1}}\\par\\vspace{0.02em}\\leftskip=0.7em\\rightskip=0pt\\parindent=0pt\\parskip=0.15em}{\\par\\vspace{0.02em}\\noindent\\color{StudioAnnotationBorder}\\hrule height 0.45pt\\par\\endgroup\\vspace{0.22em}}
\\usepackage{caption}
\\captionsetup[figure]{justification=raggedright,singlelinecheck=false}
\\usepackage{enumitem}
\\setlist[itemize]{nosep, leftmargin=1.5em}
\\setlist[enumerate]{nosep, leftmargin=1.5em}
\\usepackage{parskip}
\\usepackage{fvextra}
\\makeatletter
\\@ifundefined{Highlighting}{%
  \\DefineVerbatimEnvironment{Highlighting}{Verbatim}{commandchars=\\\\\\{\\},breaklines,breakanywhere}%
}{%
  \\RecustomVerbatimEnvironment{Highlighting}{Verbatim}{commandchars=\\\\\\{\\},breaklines,breakanywhere}%
}
\\makeatother
`;
}

function buildPrototypePdfPandocVariableArgs(allowAltDocumentClass = false): string[] {
  const args: string[] = [];
  if (allowAltDocumentClass) {
    args.push("-V", "documentclass=article");
  }
  args.push("-V", "geometry:margin=2.2cm");
  args.push("-V", "fontsize=11pt");
  args.push("-V", "linestretch=1.25");
  return args;
}

function preparePrototypePdfMarkdown(markdown: string, isLatex?: boolean, editorLanguage?: string): string {
  if (isLatex) return markdown;
  const effectiveEditorLanguage = inferPrototypePdfLanguage(markdown, editorLanguage);
  const source = effectiveEditorLanguage && effectiveEditorLanguage !== "markdown" && effectiveEditorLanguage !== "latex"
    && !isPrototypeSingleFencedCodeBlock(markdown)
    ? wrapPrototypeCodeAsMarkdown(markdown, effectiveEditorLanguage)
    : markdown;
  const annotationReadySource = !effectiveEditorLanguage || effectiveEditorLanguage === "markdown" || effectiveEditorLanguage === "latex"
    ? replacePrototypeAnnotationMarkersForPdf(source)
    : source;
  const commentStrippedSource = stripPrototypeMarkdownHtmlComments(annotationReadySource);
  return normalizeObsidianImages(normalizeMathDelimiters(commentStrippedSource));
}

async function runPrototypePandocPdfExport(
  markdown: string,
  inputFormat: string,
  pandocCommand: string,
  pdfEngine: string,
  resourcePath: string | undefined,
  bibliographyArgs: string[],
): Promise<Buffer> {
  const tempDir = join(tmpdir(), `pi-studio-opencode-pdf-${Date.now()}-${randomUUID()}`);
  const preamblePath = join(tempDir, "_pdf_preamble.tex");
  const outputPath = join(tempDir, "studio-export.pdf");
  const pandocWorkingDir = await resolvePrototypePdfWorkingDir(resourcePath);

  await mkdir(tempDir, { recursive: true });
  await writeFile(preamblePath, buildPrototypePdfPreamble(), "utf8");

  const args = [
    "-f", inputFormat,
    "-o", outputPath,
    `--pdf-engine=${pdfEngine}`,
    ...buildPrototypePdfPandocVariableArgs(inputFormat !== "latex"),
    "-V", "urlcolor=blue",
    "-V", "linkcolor=blue",
    "--include-in-header", preamblePath,
    ...bibliographyArgs,
  ];
  if (resourcePath) args.push(`--resource-path=${resourcePath}`);

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(pandocCommand, args, { stdio: ["pipe", "pipe", "pipe"], cwd: pandocWorkingDir });
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });

      child.once("error", (error) => {
        const errno = error as NodeJS.ErrnoException;
        if (errno.code === "ENOENT") {
          const commandHint = pandocCommand === "pandoc"
            ? "pandoc was not found. Install pandoc or set PANDOC_PATH to the pandoc binary."
            : `${pandocCommand} was not found. Check PANDOC_PATH.`;
          fail(new Error(commandHint));
          return;
        }
        fail(error);
      });

      child.once("close", (code) => {
        if (settled) return;
        if (code === 0) {
          settled = true;
          resolvePromise();
          return;
        }
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        const hint = stderr.includes("not found") || stderr.includes("xelatex") || stderr.includes("pdflatex")
          ? "\nPDF export requires a LaTeX engine. Install TeX Live (e.g. brew install --cask mactex) or set PANDOC_PDF_ENGINE."
          : "";
        fail(new Error(`pandoc PDF export failed with exit code ${code}${stderr ? `: ${stderr}` : ""}${hint}`));
      });

      child.stdin.end(markdown);
    });

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function renderPrototypePdfFromGeneratedLatex(
  markdown: string,
  inputFormat: string,
  pandocCommand: string,
  pdfEngine: string,
  resourcePath: string | undefined,
  bibliographyArgs: string[],
  calloutBlocks: PrototypePdfCalloutBlock[],
  alignedImageBlocks: PrototypePdfAlignedImageBlock[],
): Promise<Buffer> {
  const tempDir = join(tmpdir(), `pi-studio-opencode-pdf-${Date.now()}-${randomUUID()}`);
  const preamblePath = join(tempDir, "_pdf_preamble.tex");
  const latexPath = join(tempDir, "studio-export.tex");
  const outputPath = join(tempDir, "studio-export.pdf");
  const pandocWorkingDir = await resolvePrototypePdfWorkingDir(resourcePath);

  await mkdir(tempDir, { recursive: true });
  await writeFile(preamblePath, buildPrototypePdfPreamble(), "utf8");

  const pandocArgs = [
    "-f", inputFormat,
    "-t", "latex",
    "-s",
    "-o", latexPath,
    ...buildPrototypePdfPandocVariableArgs(inputFormat !== "latex"),
    "-V", "urlcolor=blue",
    "-V", "linkcolor=blue",
    "--include-in-header", preamblePath,
    ...bibliographyArgs,
  ];
  if (resourcePath) pandocArgs.push(`--resource-path=${resourcePath}`);

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(pandocCommand, pandocArgs, { stdio: ["pipe", "pipe", "pipe"], cwd: pandocWorkingDir });
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });

      child.once("error", (error) => {
        const errno = error as NodeJS.ErrnoException;
        if (errno.code === "ENOENT") {
          const commandHint = pandocCommand === "pandoc"
            ? "pandoc was not found. Install pandoc or set PANDOC_PATH to the pandoc binary."
            : `${pandocCommand} was not found. Check PANDOC_PATH.`;
          fail(new Error(commandHint));
          return;
        }
        fail(error);
      });

      child.once("close", (code) => {
        if (settled) return;
        if (code === 0) {
          settled = true;
          resolvePromise();
          return;
        }
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        fail(new Error(`pandoc LaTeX generation failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
      });

      child.stdin.end(markdown);
    });

    const generatedLatex = await readFile(latexPath, "utf8");
    const calloutReadyLatex = replacePrototypePdfCalloutBlocksInGeneratedLatex(generatedLatex, calloutBlocks);
    const alignedReadyLatex = replacePrototypePdfAlignedImageBlocksInGeneratedLatex(calloutReadyLatex, alignedImageBlocks);
    await writeFile(latexPath, alignedReadyLatex, "utf8");

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(pdfEngine, [
        "-interaction=nonstopmode",
        "-halt-on-error",
        `-output-directory=${tempDir}`,
        latexPath,
      ], { stdio: ["ignore", "pipe", "pipe"], cwd: pandocWorkingDir });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
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
          fail(new Error(
            `${pdfEngine} was not found. Install TeX Live (e.g. brew install --cask mactex) or set PANDOC_PDF_ENGINE.`,
          ));
          return;
        }
        fail(error);
      });

      child.once("close", (code) => {
        if (settled) return;
        if (code === 0) {
          settled = true;
          resolvePromise();
          return;
        }
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        const errorMatch = stdout.match(/^! .+$/m);
        const hint = errorMatch ? `: ${errorMatch[0]}` : (stderr ? `: ${stderr}` : "");
        fail(new Error(`${pdfEngine} PDF export failed with exit code ${code}${hint}`));
      });
    });

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderPrototypePdfWithPandoc(markdown: string, options: PrototypePdfRenderOptions = {}): Promise<{ pdf: Buffer; warning?: string }> {
  const source = String(markdown ?? "");
  const isLatex = options.isLatex === true;
  const pandocCommand = process.env.PANDOC_PATH?.trim() || "pandoc";
  const pdfEngine = process.env.PANDOC_PDF_ENGINE?.trim() || "xelatex";
  const effectiveEditorLanguage = inferPrototypePdfLanguage(source, options.editorPdfLanguage);
  const pdfCalloutTransform = !isLatex && (!effectiveEditorLanguage || effectiveEditorLanguage === "markdown")
    ? preprocessPrototypeMarkdownCalloutsForPdf(source)
    : { markdown: source, blocks: [] as PrototypePdfCalloutBlock[] };
  const pdfAlignedImageTransform = !isLatex && (!effectiveEditorLanguage || effectiveEditorLanguage === "markdown")
    ? preprocessPrototypeMarkdownImageAlignmentForPdf(pdfCalloutTransform.markdown)
    : { markdown: pdfCalloutTransform.markdown, blocks: [] as PrototypePdfAlignedImageBlock[] };
  const bibliographyArgs = await buildPrototypePandocBibliographyArgs(source, isLatex, options.resourcePath);
  const inputFormat = isLatex
    ? "latex"
    : "markdown+lists_without_preceding_blankline-blank_before_blockquote-blank_before_header+tex_math_dollars+tex_math_single_backslash+tex_math_double_backslash+autolink_bare_uris+superscript+subscript-raw_html";
  const normalizedMarkdown = preparePrototypePdfMarkdown(pdfAlignedImageTransform.markdown, isLatex, effectiveEditorLanguage);

  if (!isLatex && (pdfCalloutTransform.blocks.length > 0 || pdfAlignedImageTransform.blocks.length > 0)) {
    return {
      pdf: await renderPrototypePdfFromGeneratedLatex(
        normalizedMarkdown,
        inputFormat,
        pandocCommand,
        pdfEngine,
        options.resourcePath,
        bibliographyArgs,
        pdfCalloutTransform.blocks,
        pdfAlignedImageTransform.blocks,
      ),
    };
  }

  return {
    pdf: await runPrototypePandocPdfExport(
      normalizedMarkdown,
      inputFormat,
      pandocCommand,
      pdfEngine,
      options.resourcePath,
      bibliographyArgs,
    ),
  };
}

export function sanitizePrototypePdfFilename(input: string | undefined): string {
  const fallback = "studio-preview.pdf";
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;

  const noPath = raw.split(/[\\/]/).pop() ?? raw;
  const cleaned = noPath
    .replace(/[\x00-\x1f\x7f]+/g, "")
    .replace(/[<>:\"|?*]+/g, "-")
    .trim();
  if (!cleaned) return fallback;

  const ensuredExt = cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
  if (ensuredExt.length <= 160) return ensuredExt;
  return `${ensuredExt.slice(0, 156)}.pdf`;
}
