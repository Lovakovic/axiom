import { JSONSchemaDraft7 } from '../../../shared/util/types';
import { convertJSONSchemaDraft7ToZod } from '../../../shared/util/draftToZod';

export const editBlockJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    file_path: {type: "string", description: "Path to the file to edit."},
    old_text: {type: "string", description: "The exact text block to find and replace. Can be multi-line."},
    new_text: {type: "string", description: "The new text block to replace the old_text with. Can be multi-line."},
    expected_replacements: {
      type: "number",
      description: "The number of times 'old_text' is expected to be found and replaced. If actual occurrences differ, the operation might fail or provide a warning with fuzzy match details."
    },
    use_fuzzy_match_if_needed: {
      type: "boolean",
      description: "If true and exact match not found or count mismatch, attempt to use the best fuzzy match (if similarity is high enough). Default is false (fail on exact mismatch)."
    }
  },
  required: ["file_path", "old_text", "new_text"]
};
export const EditBlockArgsSchema = convertJSONSchemaDraft7ToZod(editBlockJSONSchema);