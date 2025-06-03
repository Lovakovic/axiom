import { JSONSchemaDraft7 } from '../../../shared/util/types';
import { convertJSONSchemaDraft7ToZod } from '../../../shared/util/draftToZod';
import { DEFAULT_FILE_READ_LINE_LIMIT, DEFAULT_FILE_WRITE_LINE_LIMIT } from "../common/utils";

export const readFileJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    path: {type: "string", description: "Path to the file or URL to read."},
    is_url: {type: "boolean", description: "Set to true if 'path' is a URL."},
    offset: {
      type: "number",
      description: "For text files: line number to start reading from (0-indexed). Ignored for images and URLs."
    },
    length: {
      type: "number",
      description: `For text files: maximum number of lines to read. Ignored for images and URLs. Default: ${DEFAULT_FILE_READ_LINE_LIMIT}`
    }
  },
  required: ["path"]
};
export const ReadFileArgsSchema = convertJSONSchemaDraft7ToZod(readFileJSONSchema);
export const readMultipleFilesJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    paths: {type: "array", items: {type: "string"}, description: "An array of file paths to read."}
  },
  required: ["paths"]
};
export const ReadMultipleFilesArgsSchema = convertJSONSchemaDraft7ToZod(readMultipleFilesJSONSchema);


export const writeFileJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    path: {type: "string", description: "Path to the file to write."},
    content: {type: "string", description: "The content to write to the file."},
    mode: {type: "string", enum: ["rewrite", "append"], description: "Mode: 'rewrite' (overwrite) or 'append'."},
    max_lines_per_write: {
      type: "number",
      description: `Internal hint for agent: Content will be rejected if it exceeds this many lines. Agent must chunk if content is larger. Default: ${DEFAULT_FILE_WRITE_LINE_LIMIT}`
    }
  },
  required: ["path", "content"]
};
export const WriteFileArgsSchema = convertJSONSchemaDraft7ToZod(writeFileJSONSchema);

export const createDirectoryJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    path: {type: "string", description: "Path for the new directory. Can create nested directories."}
  },
  required: ["path"]
};
export const CreateDirectoryArgsSchema = convertJSONSchemaDraft7ToZod(createDirectoryJSONSchema);

export const listDirectoryJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    path: {type: "string", description: "Path of the directory to list."},
    recursive: {type: "boolean", description: "Set to true to list directories recursively."},
    depth: {type: "number", description: "Max depth for recursive listing, if recursive is true."}
  },
  required: ["path"]
};
export const ListDirectoryArgsSchema = convertJSONSchemaDraft7ToZod(listDirectoryJSONSchema);

export const moveFileJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    source: {type: "string", description: "Source path of the file or directory to move/rename."},
    destination: {type: "string", description: "Destination path."}
  },
  required: ["source", "destination"]
};
export const MoveFileArgsSchema = convertJSONSchemaDraft7ToZod(moveFileJSONSchema);

export const getFileInfoJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    path: {type: "string", description: "Path to the file or directory to get information about."}
  },
  required: ["path"]
};
export const GetFileInfoArgsSchema = convertJSONSchemaDraft7ToZod(getFileInfoJSONSchema);