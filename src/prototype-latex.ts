import { readFileSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function expandPrototypeHome(input: string): string {
  if (!input) return input;
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function resolvePrototypeLatexWorkingDir(baseDir: string | undefined): string | undefined {
  const normalized = typeof baseDir === "string" ? baseDir.trim() : "";
  if (!normalized) return undefined;
  try {
    return statSync(normalized).isDirectory() ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function stripPrototypeLatexComments(text: string): string {
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

export function collectPrototypeLatexBibliographyCandidates(markdown: string): string[] {
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

export async function resolvePrototypeLatexBibliographyPaths(markdown: string, baseDir: string | undefined): Promise<string[]> {
  const workingDir = resolvePrototypeLatexWorkingDir(baseDir);
  if (!workingDir) return [];
  const resolvedPaths: string[] = [];
  const seen = new Set<string>();

  for (const candidate of collectPrototypeLatexBibliographyCandidates(markdown)) {
    const expanded = expandPrototypeHome(candidate);
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

export async function buildPrototypePandocBibliographyArgs(markdown: string, isLatex: boolean | undefined, baseDir: string | undefined): Promise<string[]> {
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

function parsePrototypeAuxTopLevelGroups(input: string): string[] {
  const groups: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i += 1;
    if (i >= input.length) break;
    if (input[i] !== "{") break;
    i += 1;
    let depth = 1;
    let current = "";
    while (i < input.length && depth > 0) {
      const ch = input[i]!;
      i += 1;
      if (ch === "{") {
        depth += 1;
        current += ch;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth > 0) current += ch;
        continue;
      }
      current += ch;
    }
    groups.push(current);
  }
  return groups;
}

function resolvePrototypeLatexAuxPath(sourcePath: string | undefined, baseDir: string | undefined): string | undefined {
  const source = typeof sourcePath === "string" ? sourcePath.trim() : "";
  const workingDir = resolvePrototypeLatexWorkingDir(baseDir);
  if (!source) return undefined;
  const expanded = expandPrototypeHome(source);
  const resolvedSource = isAbsolute(expanded)
    ? expanded
    : resolve(workingDir || process.cwd(), expanded);

  if (!/\.(tex|latex)$/i.test(resolvedSource)) return undefined;
  const auxPath = resolvedSource.replace(/\.[^.]+$/i, ".aux");
  try {
    return statSync(auxPath).isFile() ? auxPath : undefined;
  } catch {
    return undefined;
  }
}

export function readPrototypeLatexAuxLabels(
  sourcePath: string | undefined,
  baseDir: string | undefined,
): Map<string, { number: string; kind: string }> {
  const auxPath = resolvePrototypeLatexAuxPath(sourcePath, baseDir);
  const labels = new Map<string, { number: string; kind: string }>();
  if (!auxPath) return labels;

  let text = "";
  try {
    text = readFileSync(auxPath, "utf-8");
  } catch {
    return labels;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\\newlabel\{([^}]+)\}\{(.*)\}$/);
    if (!match) continue;
    const label = match[1] ?? "";
    if (!label || label.endsWith("@cref")) continue;
    const groups = parsePrototypeAuxTopLevelGroups(match[2] ?? "");
    if (groups.length === 0) continue;
    const number = String(groups[0] ?? "").trim();
    if (!number) continue;
    const rawKind = String(groups[3] ?? "").trim();
    const kind = rawKind.split(".")[0] || (label.startsWith("eq:") ? "equation" : label.startsWith("fig:") ? "figure" : "ref");
    labels.set(label, { number, kind });
  }

  return labels;
}

export function formatPrototypeLatexReference(
  label: string,
  referenceType: "eqref" | "ref" | "autoref",
  labels: ReadonlyMap<string, { number: string; kind: string }>,
): string | null {
  const entry = labels.get(label);
  if (!entry) return null;
  if (referenceType === "eqref") return `(${entry.number})`;
  if (referenceType === "autoref") {
    if (entry.kind === "equation") return `Equation ${entry.number}`;
    if (entry.kind === "figure") return `Figure ${entry.number}`;
    if (entry.kind === "section" || entry.kind === "subsection" || entry.kind === "subsubsection") return `Section ${entry.number}`;
    if (entry.kind === "algorithm") return `Algorithm ${entry.number}`;
  }
  return entry.number;
}

export function preprocessPrototypeLatexReferences(markdown: string, sourcePath: string | undefined, baseDir: string | undefined): string {
  const labels = readPrototypeLatexAuxLabels(sourcePath, baseDir);
  if (labels.size === 0) return markdown;
  let transformed = String(markdown ?? "");
  transformed = transformed.replace(/\\eqref\s*\{([^}]+)\}/g, (match, label) => formatPrototypeLatexReference(String(label || "").trim(), "eqref", labels) ?? match);
  transformed = transformed.replace(/\\autoref\s*\{([^}]+)\}/g, (match, label) => formatPrototypeLatexReference(String(label || "").trim(), "autoref", labels) ?? match);
  transformed = transformed.replace(/\\ref\s*\{([^}]+)\}/g, (match, label) => formatPrototypeLatexReference(String(label || "").trim(), "ref", labels) ?? match);
  return transformed;
}

function escapePrototypeHtmlText(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function decoratePrototypeLatexRenderedHtml(html: string, sourcePath: string | undefined, baseDir: string | undefined): string {
  const labels = readPrototypeLatexAuxLabels(sourcePath, baseDir);
  let transformed = String(html ?? "");
  if (labels.size === 0) return transformed;

  transformed = transformed.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (match, attrs) => {
    const typeMatch = String(attrs ?? "").match(/\bdata-reference-type="([^"]+)"/);
    const labelMatch = String(attrs ?? "").match(/\bdata-reference="([^"]+)"/);
    if (!typeMatch || !labelMatch) return match;
    const referenceTypeRaw = String(typeMatch[1] ?? "").trim();
    const label = String(labelMatch[1] ?? "").trim();
    const referenceType = referenceTypeRaw === "eqref" || referenceTypeRaw === "autoref" || referenceTypeRaw === "ref"
      ? referenceTypeRaw
      : null;
    if (!referenceType || !label) return match;
    const formatted = formatPrototypeLatexReference(label, referenceType, labels);
    if (!formatted) return match;
    return `<a${attrs}>${escapePrototypeHtmlText(formatted)}</a>`;
  });

  transformed = transformed.replace(/<math\b[^>]*display="block"[^>]*>[\s\S]*?<\/math>/g, (block) => {
    if (/studio-display-equation/.test(block)) return block;
    const labelMatch = block.match(/\\label\s*\{([^}]+)\}/);
    if (!labelMatch) return block;
    const label = String(labelMatch[1] ?? "").trim();
    if (!label) return block;
    const formatted = formatPrototypeLatexReference(label, "eqref", labels);
    if (!formatted) return block;
    return `<div class="studio-display-equation"><div class="studio-display-equation-body">${block}</div><div class="studio-display-equation-number">${escapePrototypeHtmlText(formatted)}</div></div>`;
  });

  return transformed;
}

export function injectPrototypeLatexEquationTags(markdown: string, sourcePath: string | undefined, baseDir: string | undefined): string {
  const labels = readPrototypeLatexAuxLabels(sourcePath, baseDir);
  if (labels.size === 0) return markdown;
  return String(markdown ?? "").replace(/\\label\s*\{([^}]+)\}/g, (match, label) => {
    const entry = labels.get(String(label || "").trim());
    if (!entry || entry.kind !== "equation") return match;
    return `\\tag{${entry.number}}\\label{${String(label || "").trim()}}`;
  });
}
