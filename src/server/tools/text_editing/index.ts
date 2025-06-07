import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs/promises";
import {
  normalizeAndEnsurePath,
  detectLineEnding,
  normalizeLineEndings,
  PATH_GUIDANCE,
  CMD_PREFIX_DESCRIPTION,
  DEFAULT_FILE_WRITE_LINE_LIMIT
} from "../common/utils";
import { editBlockJSONSchema, EditBlockArgsSchema } from "./schemas";
import { findBestFuzzyMatch, highlightDifferences } from "./fuzzySearch";
import os from "os";

const FUZZY_SIMILARITY_THRESHOLD = 0.8;

export const editBlockToolDefinition: Tool = {
  name: "edit_file_block",
  description: `
Edit a block of text within a file.
Finds 'old_text' and replaces it with 'new_text'.
Supports exact matches and optional fuzzy matching if exact fails or count mismatches.
Line endings are auto-detected and preserved.
WARNING: 'new_text' exceeding line limits (default ${DEFAULT_FILE_WRITE_LINE_LIMIT}) will be REJECTED for this tool.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: editBlockJSONSchema
};

export async function editBlockHandler(args: z.infer<typeof EditBlockArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedPath = await normalizeAndEnsurePath(args.file_path);
    const expectedReplacements = args.expected_replacements ?? 1;
    const useFuzzy = args.use_fuzzy_match_if_needed ?? false;

    const newTextLineCount = args.new_text.split('\n').length;
    if (newTextLineCount > DEFAULT_FILE_WRITE_LINE_LIMIT) {
      return { content: [{ type: 'text', text: `Error: new_text has ${newTextLineCount} lines, exceeding the limit of ${DEFAULT_FILE_WRITE_LINE_LIMIT} for edit_file_block. Use 'write_file' for large replacements or reduce new_text size.` }], isError: true };
    }

    let fileContent: string;
    let originalLineEnding: ReturnType<typeof detectLineEnding>;
    try {
      fileContent = await fs.readFile(resolvedPath, 'utf-8');
      originalLineEnding = detectLineEnding(fileContent);
    } catch (readError: any) {
      if (readError.code === 'ENOENT') { // File not found
        // If old_text is empty, we can create the file with new_text
        if (args.old_text === "") {
          const normalizedNewText = normalizeLineEndings(args.new_text, os.platform() === 'win32' ? '\r\n' : '\n');
          await fs.writeFile(resolvedPath, normalizedNewText, 'utf-8');
          return { content: [{ type: 'text', text: `File ${resolvedPath} did not exist. Created new file with provided new_text.`}] };
        }
      }
      return { content: [{ type: 'text', text: `Error reading file ${resolvedPath}: ${readError.message}` }], isError: true };
    }

    const normalizedOldText = normalizeLineEndings(args.old_text, originalLineEnding);
    const normalizedNewText = normalizeLineEndings(args.new_text, originalLineEnding);

    const occurrences: { index: number }[] = [];
    if (normalizedOldText !== "") { // Only search if old_text is not empty
      let currentIndex = fileContent.indexOf(normalizedOldText);
      while (currentIndex !== -1) {
        occurrences.push({ index: currentIndex });
        currentIndex = fileContent.indexOf(normalizedOldText, currentIndex + normalizedOldText.length);
      }
    } else if (args.old_text === "" && args.new_text !== "") {
      // If old_text is empty, it means prepend new_text (or replace entire file if it was empty)
      const updatedContent = normalizedNewText + fileContent;
      await fs.writeFile(resolvedPath, updatedContent, 'utf-8');
      return { content: [{ type: 'text', text: `Prepended new_text to ${resolvedPath} as old_text was empty.` }] };
    } else { // Both old and new are empty
      return { content: [{ type: 'text', text: `Both old_text and new_text are empty. No changes made to ${resolvedPath}.` }] };
    }


    if (occurrences.length === expectedReplacements) {
      let updatedContent = fileContent;
      for (let i = occurrences.length - 1; i >= 0; i--) {
        const occ = occurrences[i];
        updatedContent = updatedContent.substring(0, occ.index) +
          normalizedNewText +
          updatedContent.substring(occ.index + normalizedOldText.length);
      }
      await fs.writeFile(resolvedPath, updatedContent, 'utf-8');
      return { content: [{ type: 'text', text: `Successfully replaced ${occurrences.length} occurrence(s) of the text in ${resolvedPath}.` }] };
    } else {
      let message = `Expected ${expectedReplacements} exact occurrences of 'old_text', but found ${occurrences.length}.`;
      if (!useFuzzy && occurrences.length !== expectedReplacements) {
        return { content: [{ type: 'text', text: `${message} Fuzzy matching not enabled or not applicable. No changes made.` }], isError: true };
      }

      if (useFuzzy && occurrences.length === 0) { // Attempt fuzzy only if enabled AND no exact matches found
        const fuzzy = findBestFuzzyMatch(fileContent, normalizedOldText);
        message += `\nAttempting fuzzy match for 'old_text'. Best fuzzy match found (similarity: ${(fuzzy.similarity * 100).toFixed(1)}%):`;
        const diff = highlightDifferences(normalizedOldText, fuzzy.value);
        message += `\nDiff (Expected vs Found):\n${diff}`;

        if (fuzzy.similarity >= FUZZY_SIMILARITY_THRESHOLD) {
          if (expectedReplacements > 1 && occurrences.length === 0) { // Only if NO exact matches and multiple fuzzy were expected
            message += `\nFuzzy match found one strong candidate. Replacing this single instance. For multiple fuzzy replacements, ensure 'old_text' is very specific or perform edits one by one.`;
          }
          const updatedContent = fileContent.substring(0, fuzzy.start) +
            normalizedNewText +
            fileContent.substring(fuzzy.end);
          await fs.writeFile(resolvedPath, updatedContent, 'utf-8');
          return { content: [{ type: 'text', text: `${message}\nReplaced the best fuzzy match in ${resolvedPath}.` }] };
        } else {
          message += `\nFuzzy match similarity is below threshold of ${(FUZZY_SIMILARITY_THRESHOLD * 100).toFixed(1)}%. No changes made.`;
          return { content: [{ type: 'text', text: message }], isError: true };
        }
      } else {
        // Exact matches found, but count mismatch, and fuzzy is enabled.
        // Prioritize agent's explicit expected_replacements count.
        return { content: [{ type: 'text', text: `${message}\n'use_fuzzy_match_if_needed' is true, but exact matches were found with an unexpected count. Agent should adjust 'expected_replacements' or make 'old_text' more specific. No changes made.` }], isError: true };
      }
    }
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error editing file block in ${args.file_path}: ${error.message}` }], isError: true };
  }
}
