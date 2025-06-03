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

export function getSimilarityRatio(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0; // Both empty
  const dist = distance(a, b);
  return 1.0 - (dist / maxLength);
}

/**
 * Generates a character-level diff using standard {-removed-}{+added+} format.
 * This is a simplified diff to highlight differences.
 */
export function highlightDifferences(expected: string, actual: string): string {
  // Simple placeholder diff for now. A more sophisticated algorithm (e.g., Myers diff)
  // would be better for complex changes but is harder to implement briefly.
  // This basic version just shows common prefix/suffix and the differing middle parts.

  let prefixLength = 0;
  const minLength = Math.min(expected.length, actual.length);
  while (prefixLength < minLength && expected[prefixLength] === actual[prefixLength]) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (suffixLength < minLength - prefixLength &&
  expected[expected.length - 1 - suffixLength] === actual[actual.length - 1 - suffixLength]) {
    suffixLength++;
  }

  const commonPrefix = expected.substring(0, prefixLength);
  const commonSuffix = expected.substring(expected.length - suffixLength);

  const expectedDiffPart = expected.substring(prefixLength, expected.length - suffixLength);
  const actualDiffPart = actual.substring(prefixLength, actual.length - suffixLength);

  if (expectedDiffPart === "" && actualDiffPart === "") return `${commonPrefix}${commonSuffix} (Exact match)`;

  return `${commonPrefix}{-${expectedDiffPart}-}{+${actualDiffPart}+}${commonSuffix}`;
}