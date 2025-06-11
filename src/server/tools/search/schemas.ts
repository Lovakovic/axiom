import { JSONSchemaDraft7 } from '../../../shared/util/types';
import { convertJSONSchemaDraft7ToZod } from '../../../shared/util/draftToZod';

export const searchFilesJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    root_path: { type: "string", description: "The root directory path to start searching from." },
    pattern: { type: "string", description: "The filename pattern to search for (case-insensitive substring match)." },
    recursive: { type: "boolean", description: "Search recursively." },
    max_depth: { type: "number", description: "Maximum depth for recursive search." },
    timeout_ms: { type: "number", description: "Timeout in milliseconds for the search operation." }
  },
  required: ["root_path", "pattern"]
};
export const SearchFilesArgsSchema = convertJSONSchemaDraft7ToZod(searchFilesJSONSchema);

export const searchCodeJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    root_path: { type: "string", description: "The root directory path to search within." },
    search_pattern: { type: "string", description: "The text or regex pattern to search for in file contents." },
    file_glob_pattern: { type: "string", description: "Optional glob pattern to filter files (e.g., '*.ts', '!*.log'). Consult ripgrep glob syntax." },
    case_sensitive: { type: "boolean", description: "Perform a case-sensitive search." },
    max_results_per_file: { type: "number", description: "Maximum number of matches to return per file." },
    max_total_results: { type: "number", description: "Maximum total number of matches to return across all files." },
    include_hidden: { type: "boolean", description: "Include hidden files and directories in the search." },
    context_lines: { type: "number", description: "Number of context lines to show before and after each match (0-10)." },
    timeout_ms: { type: "number", description: "Timeout for the search operation." }
  },
  required: ["root_path", "search_pattern"]
};
export const SearchCodeArgsSchema = convertJSONSchemaDraft7ToZod(searchCodeJSONSchema);