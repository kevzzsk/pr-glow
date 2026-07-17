export interface LineRange {
  /** 1-based first changed line in the new file */
  start: number;
  /** 1-based last changed line in the new file (inclusive) */
  end: number;
}

export type FileChanges = Map<string, LineRange[]>;

/**
 * Parse a unified diff (with or without context lines) and return, per file,
 * the 1-based line ranges in the NEW version that were added or modified.
 *
 * Deleted-only hunks produce no range (there is no line in the new file to mark).
 * Paths are taken from the "+++ b/<path>" header; /dev/null (deleted files) is skipped.
 */
export function parseUnifiedDiff(diffText: string): FileChanges {
  const changes: FileChanges = new Map();
  if (!diffText) {
    return changes;
  }

  const lines = diffText.split('\n');
  let currentFile: string | undefined;
  let currentRanges: LineRange[] = [];
  let newLine = 0;
  let inHunk = false;

  const flushFile = () => {
    if (currentFile && currentRanges.length > 0) {
      changes.set(currentFile, mergeRanges(currentRanges));
    }
    currentRanges = [];
  };

  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      flushFile();
      const rawPath = line.slice(4).trim();
      if (rawPath === '/dev/null') {
        currentFile = undefined;
      } else {
        currentFile = rawPath.replace(/^b\//, '').replace(/\t.*$/, '');
      }
      inHunk = false;
      continue;
    }

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentFile) {
      continue;
    }

    if (line.startsWith('+')) {
      currentRanges.push({ start: newLine, end: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      // removed line: no new-file line advances
    } else if (line.startsWith(' ') || line === '') {
      newLine++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — ignore
    } else {
      // any other content (e.g. next "diff --git" header) ends the hunk
      inHunk = false;
    }
  }
  flushFile();

  return changes;
}

/** Merge adjacent/overlapping single-line ranges into contiguous blocks. */
export function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= last.end + 1) {
      last.end = Math.max(last.end, next.end);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}
