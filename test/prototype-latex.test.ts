import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPrototypePandocBibliographyArgs,
  injectPrototypeLatexEquationTags,
  preprocessPrototypeLatexReferences,
  readPrototypeLatexAuxLabels,
} from "../src/prototype-latex.js";

test("buildPrototypePandocBibliographyArgs resolves bibliography files for LaTeX", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-opencode-latex-bib-"));
  try {
    const texPath = join(dir, "paper.tex");
    const bibPath = join(dir, "refs.bib");
    await writeFile(texPath, "\\documentclass{article}\n\\begin{document}\n\\bibliography{refs}\n\\end{document}\n", "utf8");
    await writeFile(bibPath, "@article{demo,title={Demo}}\n", "utf8");

    const args = await buildPrototypePandocBibliographyArgs(
      "\\documentclass{article}\n\\begin{document}\n\\bibliography{refs}\n\\end{document}\n",
      true,
      dir,
    );

    assert.deepEqual(args, [
      "--citeproc",
      "-M",
      "reference-section-title=References",
      "--bibliography",
      bibPath,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LaTeX aux helpers resolve ref, eqref, autoref, and equation tags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-opencode-latex-aux-"));
  try {
    const texPath = join(dir, "paper.tex");
    const auxPath = join(dir, "paper.aux");
    await writeFile(texPath, "\\documentclass{article}\n\\begin{document}\nSee \\ref{sec:intro}, \\eqref{eq:test}, and \\autoref{fig:demo}.\\n\\end{document}\n", "utf8");
    await writeFile(
      auxPath,
      [
        "\\newlabel{sec:intro}{{1}{1}{Introduction}{section.1}{}}",
        "\\newlabel{eq:test}{{3}{1}{}{equation.0.3}{}}",
        "\\newlabel{fig:demo}{{2}{1}{Figure caption}{figure.2}{}}",
      ].join("\n"),
      "utf8",
    );

    const labels = readPrototypeLatexAuxLabels(texPath, dir);
    assert.equal(labels.get("sec:intro")?.number, "1");
    assert.equal(labels.get("eq:test")?.kind, "equation");
    assert.equal(labels.get("fig:demo")?.kind, "figure");

    const source = "See \\ref{sec:intro}, \\eqref{eq:test}, and \\autoref{fig:demo}.\\n\\begin{equation}x=1\\label{eq:test}\\end{equation}";
    const resolved = preprocessPrototypeLatexReferences(source, texPath, dir);
    assert.match(resolved, /See 1, \(3\), and Figure 2\./);

    const tagged = injectPrototypeLatexEquationTags(source, texPath, dir);
    assert.match(tagged, /\\tag\{3\}\\label\{eq:test\}/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
