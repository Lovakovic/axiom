import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { rgPath } from "@vscode/ripgrep";

import {
  searchFilesJSONSchema, SearchFilesArgsSchema,
  searchCodeJSONSchema, SearchCodeArgsSchema
} from "./schemas";
import { normalizeAndEnsurePath, withTimeout, PATH_GUIDANCE, CMD_PREFIX_DESCRIPTION } from "../common/utils";

export const searchFilesToolDefinition: Tool = {
  name: "search_files_by_name",
  description: `
Search for files by name within a directory tree.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: searchFilesJSONSchema
};

async function findFilesRecursiveInternal(
  currentPath: string,
  normalizedPattern: string,
  isRecursive: boolean,
  currentDepth: number,
  maxDepth: number,
  results: string[]
): Promise<void> {
  if (currentDepth > maxDepth && isRecursive) return;

  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.name.toLowerCase().includes(normalizedPattern)) {
      results.push(entryPath);
    }
    if (isRecursive && entry.isDirectory()) {
      await findFilesRecursiveInternal(entryPath, normalizedPattern, isRecursive, currentDepth + 1, maxDepth, results);
    }
  }
}

export async function searchFilesHandler(args: z.infer<typeof SearchFilesArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedRootPath = await normalizeAndEnsurePath(args.root_path);
    const results: string[] = [];
    const normalizedPattern = args.pattern.toLowerCase();
    const recursive = args.recursive ?? true;
    const maxDepth = args.max_depth ?? 10;
    const timeoutMs = args.timeout_ms ?? 30000;

    const searchOp = findFilesRecursiveInternal(
      resolvedRootPath,
      normalizedPattern,
      recursive,
      1,
      maxDepth,
      results
    );

    await withTimeout(searchOp, timeoutMs);

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No files found matching pattern "${args.pattern}" in ${resolvedRootPath}.` }] };
    }
    return { content: [{ type: 'text', text: `Found files:\n${results.join('\n')}` }] };

  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error searching files: ${error.message}` }], isError: true };
  }
}

interface RipgrepMatch {
  type: 'begin' | 'match' | 'end' | 'context' | 'summary';
  data: {
    path?: { text: string };
    lines?: { text?: string; bytes?: string }; // text for match/context, bytes for binary
    line_number?: number;
    absolute_offset?: number;
    submatches?: { match: { text: string }; start: number; end: number }[];
    stats?: any;
    elapsed_total?: { secs: number, nanos: number, human: string};
  };
}

export const searchCodeToolDefinition: Tool = {
  name: "search_code_in_files",
  description: `
Search for text or regex patterns within file contents using ripgrep.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: searchCodeJSONSchema
};

export async function searchCodeHandler(args: z.infer<typeof SearchCodeArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedRootPath = await normalizeAndEnsurePath(args.root_path);
    const rgArgs: string[] = ['--json', args.search_pattern, resolvedRootPath];

    if (args.case_sensitive === true) rgArgs.unshift('-s'); else rgArgs.unshift('-i');
    if (args.file_glob_pattern) rgArgs.push('-g', args.file_glob_pattern);
    if (args.include_hidden === true) rgArgs.push('--hidden');

    const contextLines = args.context_lines ?? 0;
    if (contextLines > 0) rgArgs.push('-C', contextLines.toString());

    const maxResultsPerFile = args.max_results_per_file ?? 10;
    if (maxResultsPerFile > 0) rgArgs.push('--max-count', maxResultsPerFile.toString());

    const timeoutMs = args.timeout_ms ?? 30000;
    const maxTotalResults = args.max_total_results ?? 200;
    let matchCount = 0;

    return new Promise<CallToolResult>((resolve) => {
      const searchProcess = spawn(rgPath, rgArgs);
      let stdoutBuffer = '';
      let stderrBuffer = '';
      const foundMatches: { file: string; line: number; text: string; type: 'match' | 'context' }[] = [];

      const timer = setTimeout(() => {
        searchProcess.kill('SIGTERM');
        resolve({ content: [{ type: 'text', text: `Search timed out after ${timeoutMs}ms. Partial results (if any):\n${formatRgResults(foundMatches)}` }], isError: true });
      }, timeoutMs);

      searchProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        let nlIndex;
        while ((nlIndex = stdoutBuffer.indexOf('\n')) >= 0) {
          const line = stdoutBuffer.substring(0, nlIndex);
          stdoutBuffer = stdoutBuffer.substring(nlIndex + 1);
          if (line.trim() === '') continue;

          try {
            const jsonMatch = JSON.parse(line) as RipgrepMatch;
            if (jsonMatch.type === 'match' || jsonMatch.type === 'context') {
              let lineText: string | undefined;
              if (jsonMatch.data.lines) {
                if ('text' in jsonMatch.data.lines && typeof jsonMatch.data.lines.text === 'string') {
                  lineText = jsonMatch.data.lines.text;
                } else if ('bytes' in jsonMatch.data.lines && typeof jsonMatch.data.lines.bytes === 'string') {
                  try {
                    const decoded = Buffer.from(jsonMatch.data.lines.bytes, 'base64').toString('utf-8');
                    if (!decoded.includes('\uFFFD')) { lineText = decoded; }
                    else { lineText = `[binary data (base64): ${jsonMatch.data.lines.bytes.substring(0, 60)}...]`; }
                  } catch (e) { lineText = `[binary data: ${jsonMatch.data.lines.bytes.substring(0, 60)}...]`; }
                }
              }

              if (jsonMatch.data.path?.text && lineText !== undefined && jsonMatch.data.line_number) {
                if (jsonMatch.type === 'match') matchCount++;
                foundMatches.push({
                  file: jsonMatch.data.path.text,
                  line: jsonMatch.data.line_number,
                  text: lineText.trimEnd(),
                  type: jsonMatch.type
                });
                if (matchCount >= maxTotalResults) {
                  searchProcess.kill('SIGTERM'); break;
                }
              }
            }
          } catch (e) { console.warn(`Error parsing ripgrep JSON line: ${line}`, e); }
        }
        if (matchCount >= maxTotalResults && !searchProcess.killed) { searchProcess.kill('SIGTERM'); }
      });

      searchProcess.stderr.on('data', (data) => { stderrBuffer += data.toString(); });

      searchProcess.on('close', (code) => {
        clearTimeout(timer);
        if (stderrBuffer.trim() && code !== 0 && code !==1 ) {
          resolve({ content: [{ type: 'text', text: `Ripgrep error:\n${stderrBuffer}` }], isError: true });
          return;
        }
        if (foundMatches.length === 0) {
          resolve({ content: [{ type: 'text', text: `No matches found for "${args.search_pattern}" in ${resolvedRootPath}.` }] });
        } else {
          resolve({ content: [{ type: 'text', text: `Search results for "${args.search_pattern}":\n${formatRgResults(foundMatches)}` + (matchCount >= maxTotalResults ? `\n(Stopped at max total results: ${maxTotalResults})` : "")}] });
        }
      });
      searchProcess.on('error', (err) => {
        clearTimeout(timer);
        resolve({ content: [{ type: 'text', text: `Failed to start ripgrep: ${err.message}` }], isError: true });
      });
    });
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error setting up code search: ${error.message}` }], isError: true };
  }
}

function formatRgResults(matches: { file: string; line: number; text: string, type: 'match'|'context' }[]): string {
  let output = '';
  let currentFile = '';
  matches.forEach(m => {
    if (m.file !== currentFile) {
      output += `\nFile: ${m.file}\n`;
      currentFile = m.file;
    }
    const prefix = m.type === 'context' ? '  ' : '';
    output += `${prefix}${m.line}: ${m.text}\n`;
  });
  return output.trim();
}