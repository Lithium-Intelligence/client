export interface AppliedPatch {
  content: string;
  hunks: number;
  additions: number;
  deletions: number;
}

interface TextShape {
  lines: string[];
  eol: "\n" | "\r\n";
  finalNewline: boolean;
}

function splitText(text: string): TextShape {
  const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const finalNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (finalNewline) lines.pop();
  if (lines.length === 1 && lines[0] === "" && text === "") lines.pop();
  return { lines, eol, finalNewline };
}

function joinText(shape: TextShape, lines: string[]): string {
  const body = lines.join(shape.eol);
  return shape.finalNewline ? `${body}${shape.eol}` : body;
}

function parseRangeCount(raw: string | undefined): number {
  return raw === undefined ? 1 : Number.parseInt(raw, 10);
}

export function applyUnifiedPatch(original: string, patch: string): AppliedPatch {
  if (!patch.trim()) throw new Error("Patch vazio.");

  const source = splitText(original);
  const patchLines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const output: string[] = [];
  let sourceIndex = 0;
  let patchIndex = 0;
  let hunks = 0;
  let additions = 0;
  let deletions = 0;

  while (patchIndex < patchLines.length) {
    const line = patchLines[patchIndex]!;
    if (line === "" || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff ") || line.startsWith("index ")) {
      patchIndex += 1;
      continue;
    }

    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/);
    if (!header) throw new Error(`Linha de patch inválida fora de hunk: ${line}`);

    const oldStart = Number.parseInt(header[1]!, 10);
    const oldCount = parseRangeCount(header[2]);
    const newCount = parseRangeCount(header[4]);
    const targetIndex = oldStart === 0 ? 0 : oldStart - 1;
    if (targetIndex < sourceIndex || targetIndex > source.lines.length) {
      throw new Error(`Hunk fora de ordem ou fora do arquivo em -${oldStart},${oldCount}.`);
    }

    output.push(...source.lines.slice(sourceIndex, targetIndex));
    sourceIndex = targetIndex;
    patchIndex += 1;
    hunks += 1;

    let consumedOld = 0;
    let producedNew = 0;

    while (patchIndex < patchLines.length && !patchLines[patchIndex]!.startsWith("@@ ")) {
      const patchLine = patchLines[patchIndex]!;
      if (patchLine.startsWith("--- ") || patchLine.startsWith("+++ ") || patchLine.startsWith("diff ") || patchLine.startsWith("index ")) {
        throw new Error("Patch com múltiplos arquivos não é suportado; informe um único path por chamada.");
      }
      if (patchLine === "\\ No newline at end of file") {
        patchIndex += 1;
        continue;
      }
      if (patchLine === "" && patchIndex === patchLines.length - 1) {
        patchIndex += 1;
        break;
      }

      const marker = patchLine[0];
      const text = patchLine.slice(1);
      if (marker === " ") {
        if (source.lines[sourceIndex] !== text) {
          throw new Error(`Contexto do patch não confere na linha ${sourceIndex + 1}.`);
        }
        output.push(text);
        sourceIndex += 1;
        consumedOld += 1;
        producedNew += 1;
      } else if (marker === "-") {
        if (source.lines[sourceIndex] !== text) {
          throw new Error(`Linha removida pelo patch não confere na linha ${sourceIndex + 1}.`);
        }
        sourceIndex += 1;
        consumedOld += 1;
        deletions += 1;
      } else if (marker === "+") {
        output.push(text);
        producedNew += 1;
        additions += 1;
      } else {
        throw new Error(`Prefixo inválido em linha de hunk: ${patchLine}`);
      }
      patchIndex += 1;
    }

    if (consumedOld !== oldCount || producedNew !== newCount) {
      throw new Error(
        `Contagem do hunk divergente: esperado -${oldCount}/+${newCount}, observado -${consumedOld}/+${producedNew}.`,
      );
    }
  }

  if (hunks === 0) throw new Error("Nenhum hunk @@ encontrado no patch.");
  output.push(...source.lines.slice(sourceIndex));

  return {
    content: joinText(source, output),
    hunks,
    additions,
    deletions,
  };
}

export function replaceExactOccurrences(
  original: string,
  oldText: string,
  newText: string,
  expectedOccurrences = 1,
): { content: string; replacements: number } {
  if (!oldText) throw new Error("oldText não pode ser vazio.");
  if (!Number.isInteger(expectedOccurrences) || expectedOccurrences < 1) {
    throw new Error("expectedOccurrences deve ser um inteiro positivo.");
  }

  const replacements = original.split(oldText).length - 1;
  if (replacements !== expectedOccurrences) {
    throw new Error(`Esperadas ${expectedOccurrences} ocorrência(s) de oldText, encontradas ${replacements}.`);
  }

  return { content: original.split(oldText).join(newText), replacements };
}
