import { distance } from 'fastest-levenshtein';

export interface FuzzyMatchResult {
  start: number;
  end: number;
  value: string; // The actual substring from `text` that matched best
  distance: number;
  similarity: number;
}

/**
 * Finds the best fuzzy match of a query string within a larger text.
 * This is a simplified version focusing on iterative refinement rather than full recursion.
 * @param text The text to search within.
 * @param query The query string to find.
 * @returns FuzzyMatchResult object.
 */
export function findBestFuzzyMatch(text: string, query: string): FuzzyMatchResult {
  if (!text || !query) {
    return { start: 0, end: 0, value: "", distance: query.length || text.length, similarity: 0 };
  }

  const queryLength = query.length;
  const textLength = text.length;
  let bestMatch: FuzzyMatchResult = {
    start: 0,
    end: queryLength,
    value: text.substring(0, queryLength),
    distance: distance(text.substring(0, queryLength), query),
    similarity: 0,
  };
  bestMatch.similarity = 1 - bestMatch.distance / Math.max(queryLength, bestMatch.value.length || 1);


  // Iterate through all possible substrings of text that are around the query's length
  // Consider a window around the query length for potential matches
  const minLen = Math.max(1, queryLength - Math.floor(queryLength / 2));
  const maxLen = queryLength + Math.floor(queryLength / 2);

  for (let len = minLen; len <= Math.min(maxLen, textLength); len++) {
    for (let i = 0; i <= textLength - len; i++) {
      const sub = text.substring(i, i + len);
      const d = distance(sub, query);
      if (d < bestMatch.distance) {
        bestMatch = {
          start: i,
          end: i + len,
          value: sub,
          distance: d,
          similarity: 1 - d / Math.max(queryLength, sub.length || 1),
        };
      }
      // If perfect match found, no need to search further
      if (bestMatch.distance === 0) {
        bestMatch.similarity = 1.0;
        return bestMatch;
      }
    }
  }
  return bestMatch;
}

/**
 * Generates a character-level diff using standard {-removed-}{+added+} format.
 * This implementation uses a Longest Common Subsequence (LCS) based algorithm
 * to provide a detailed, character-by-character diff.
 * @param expected The original string.
 * @param actual The new string.
 * @returns A formatted string highlighting the differences.
 */
export function highlightDifferences(expected: string, actual: string): string {
  if (expected === actual) {
    return `${expected} (Exact match)`;
  }

  // 1. Build the LCS length table (DP table)
  const M = expected.length;
  const N = actual.length;
  const dp = Array(M + 1).fill(null).map(() => Array(N + 1).fill(0));

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      if (expected[i - 1] === actual[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 2. Backtrack from the end of the DP table to build the diff
  let i = M;
  let j = N;
  const diffParts: { type: 'add' | 'remove' | 'common', text: string }[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === actual[j - 1]) {
      // Common character
      diffParts.push({ type: 'common', text: expected[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Character added in 'actual'
      diffParts.push({ type: 'add', text: actual[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      // Character removed from 'expected'
      diffParts.push({ type: 'remove', text: expected[i - 1] });
      i--;
    }
  }

  diffParts.reverse();

  // 3. Merge consecutive parts of the same type
  if (diffParts.length === 0) {
    if (expected.length > 0) return `{-${expected}-}`;
    if (actual.length > 0) return `{+${actual}+}`;
    return "";
  }

  const mergedParts: { type: 'add' | 'remove' | 'common', text: string }[] = [];
  let currentPart = { ...diffParts[0] };

  for (let k = 1; k < diffParts.length; k++) {
    if (diffParts[k].type === currentPart.type) {
      currentPart.text += diffParts[k].text;
    } else {
      mergedParts.push(currentPart);
      currentPart = { ...diffParts[k] };
    }
  }
  mergedParts.push(currentPart);

  // 4. Format the final string
  return mergedParts.map(part => {
    switch (part.type) {
      case 'common':
        return part.text;
      case 'add':
        return `{+${part.text}+}`;
      case 'remove':
        return `{-${part.text}-}`;
    }
  }).join('');
}