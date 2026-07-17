import { describe, expect, it } from 'vitest';
import { mergeRanges, parseUnifiedDiff } from '../src/core/diff';

const ZERO_CONTEXT_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,0 +11,2 @@ function main() {
+  const x = 1;
+  const y = 2;
@@ -20 +22 @@ function other() {
-  return old();
+  return updated();
diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Old title
+# New title
`;

const CONTEXT_DIFF = `diff --git a/lib/util.js b/lib/util.js
index aaaaaaa..bbbbbbb 100644
--- a/lib/util.js
+++ b/lib/util.js
@@ -3,7 +3,9 @@ const fs = require('fs');
 function read(p) {
   return fs.readFileSync(p, 'utf8');
 }
+
+function write(p, data) {
+  fs.writeFileSync(p, data);
+}

 module.exports = { read };
-// trailing comment
`;

const DELETED_FILE_DIFF = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index ccccccc..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-one
-two
-three
`;

describe('parseUnifiedDiff', () => {
  it('maps zero-context diffs to new-file line ranges per file', () => {
    const changes = parseUnifiedDiff(ZERO_CONTEXT_DIFF);
    expect(changes.get('src/app.ts')).toEqual([
      { start: 11, end: 12 },
      { start: 22, end: 22 },
    ]);
    expect(changes.get('README.md')).toEqual([{ start: 1, end: 1 }]);
  });

  it('handles diffs with context lines (provider API patches)', () => {
    const changes = parseUnifiedDiff(CONTEXT_DIFF);
    // hunk starts at new line 3; lines 3-5 are context, additions land on 6-9
    expect(changes.get('lib/util.js')).toEqual([{ start: 6, end: 9 }]);
  });

  it('produces no ranges for deleted files', () => {
    const changes = parseUnifiedDiff(DELETED_FILE_DIFF);
    expect(changes.size).toBe(0);
  });

  it('returns an empty map for empty input', () => {
    expect(parseUnifiedDiff('').size).toBe(0);
  });

  it('merges adjacent additions into contiguous ranges', () => {
    const diff = `--- a/f.txt
+++ b/f.txt
@@ -1,0 +2,1 @@
+a
@@ -2,0 +3,1 @@
+b
@@ -10,0 +20,1 @@
+far away
`;
    expect(parseUnifiedDiff(diff).get('f.txt')).toEqual([
      { start: 2, end: 3 },
      { start: 20, end: 20 },
    ]);
  });
});

describe('mergeRanges', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(
      mergeRanges([
        { start: 5, end: 6 },
        { start: 1, end: 2 },
        { start: 3, end: 3 },
        { start: 10, end: 12 },
      ]),
    ).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6 },
      { start: 10, end: 12 },
    ]);
  });

  it('handles empty input', () => {
    expect(mergeRanges([])).toEqual([]);
  });
});
