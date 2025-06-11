import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { editBlockHandler } from '../../../src/server/tools/text_editing';
import { z } from 'zod';
import { EditBlockArgsSchema } from '../../../src/server/tools/text_editing/schemas';

describe('editBlockTool', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-block-test-'));
    testFile = path.join(testDir, 'test.txt');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Basic functionality', () => {
    it('should replace exact text match', async () => {
      const content = 'Hello world\nThis is a test\nGoodbye world';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'This is a test',
        new_text: 'This is a replacement',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('Hello world\nThis is a replacement\nGoodbye world');
    });

    it('should handle multiple occurrences with correct count', async () => {
      const content = 'test\ntest\nother\ntest';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'test',
        new_text: 'replaced',
        expected_replacements: 3
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('replaced\nreplaced\nother\nreplaced');
    });

    it('should fail when expected count mismatches', async () => {
      const content = 'test\ntest\nother';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'test',
        new_text: 'replaced',
        expected_replacements: 3 // Only 2 exist
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain('Expected 3 exact occurrences');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty old_text by prepending new_text', async () => {
      const content = 'existing content';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: '',
        new_text: 'prepended text\n',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('prepended text\nexisting content');
    });

    it('should create new file when old_text is empty and file does not exist', async () => {
      const nonExistentFile = path.join(testDir, 'new-file.txt');
      
      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: nonExistentFile,
        old_text: '',
        new_text: 'new file content',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(nonExistentFile, 'utf-8');
      expect(newContent).toBe('new file content');
    });

    it('should handle both old_text and new_text being empty', async () => {
      const content = 'existing content';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: '',
        new_text: '',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Both old_text and new_text are empty');
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe(content); // Unchanged
    });

    it('should fail for non-existent file with non-empty old_text', async () => {
      const nonExistentFile = path.join(testDir, 'missing.txt');
      
      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: nonExistentFile,
        old_text: 'some text',
        new_text: 'replacement',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain('Error reading file');
    });
  });

  describe('Line ending handling', () => {
    it('should preserve CRLF line endings', async () => {
      const content = 'line1\r\nline2\r\nline3';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'line2',
        new_text: 'replaced',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('line1\r\nreplaced\r\nline3');
    });

    it('should normalize line endings in old_text to match file', async () => {
      const content = 'line1\nline2\nline3';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'line1\r\nline2', // CRLF in search
        new_text: 'replaced',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('replaced\nline3');
    });

    it('should handle mixed line endings in search text', async () => {
      const content = 'function test() {\n  console.log("hello");\n  return true;\n}';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'function test() {\r\n  console.log("hello");\r\n  return true;\r\n}',
        new_text: 'function test() {\n  console.log("world");\n  return false;\n}',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('function test() {\n  console.log("world");\n  return false;\n}');
    });
  });

  describe('Fuzzy matching', () => {
    it('should use fuzzy match when enabled and no exact match found', async () => {
      const content = 'Hello wrold\nThis is a test';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'Hello world', // Typo in file
        new_text: 'Hello universe',
        expected_replacements: 1,
        use_fuzzy_match_if_needed: true
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('Hello universe\nThis is a test');
    });

    it('should reject fuzzy match below threshold', async () => {
      const content = 'completely different text';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'Hello world',
        new_text: 'replacement',
        expected_replacements: 1,
        use_fuzzy_match_if_needed: true
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain('below threshold');
    });

    it('should not use fuzzy when exact matches exist but count mismatches', async () => {
      const content = 'test\ntest\nother';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'test',
        new_text: 'replaced',
        expected_replacements: 3, // Only 2 exist
        use_fuzzy_match_if_needed: true
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeTruthy();
      if (result.content && result.content[0] && typeof result.content[0] === 'object' && 'text' in result.content[0]) {
        expect(result.content[0].text).toContain('exact matches were found with an unexpected count');
      }
    });
  });

  describe('Large content handling', () => {
    it('should reject new_text exceeding line limit', async () => {
      const content = 'small content';
      await fs.writeFile(testFile, content);

      const largeNewText = Array(2501).fill('line').join('\n');
      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'small content',
        new_text: largeNewText,
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeTruthy();
      if (result.content && result.content[0] && typeof result.content[0] === 'object' && 'text' in result.content[0]) {
        expect(result.content[0].text).toContain('exceeding the limit');
      }
    });
  });

  describe('Complex replacement scenarios', () => {
    it('should handle code block replacements with proper indentation', async () => {
      const content = `function old() {
    console.log("old");
    return {
        value: 1
    };
}`;
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: `function old() {
    console.log("old");
    return {
        value: 1
    };
}`,
        new_text: `function new() {
    console.log("new");
    return {
        value: 2,
        updated: true
    };
}`,
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toContain('function new()');
      expect(newContent).toContain('value: 2');
      expect(newContent).toContain('updated: true');
    });

    it('should handle special characters in text', async () => {
      const content = 'const regex = /test\\d+/g;';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'const regex = /test\\d+/g;',
        new_text: 'const regex = /[a-z]+\\d*/ig;',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('const regex = /[a-z]+\\d*/ig;');
    });

    it('should handle text at the beginning of file', async () => {
      const content = 'first line\nsecond line\nthird line';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'first line',
        new_text: 'replaced first',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('replaced first\nsecond line\nthird line');
    });

    it('should handle text at the end of file', async () => {
      const content = 'first line\nsecond line\nthird line';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'third line',
        new_text: 'replaced third',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('first line\nsecond line\nreplaced third');
    });

    it('should handle entire file replacement', async () => {
      const content = 'entire file content';
      await fs.writeFile(testFile, content);

      const args: z.infer<typeof EditBlockArgsSchema> = {
        file_path: testFile,
        old_text: 'entire file content',
        new_text: 'completely new content',
        expected_replacements: 1
      };

      const result = await editBlockHandler(args);
      expect(result.isError).toBeFalsy();
      
      const newContent = await fs.readFile(testFile, 'utf-8');
      expect(newContent).toBe('completely new content');
    });
  });
});
