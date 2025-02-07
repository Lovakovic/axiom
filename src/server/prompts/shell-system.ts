export function generateShellSystemPrompt(args: Record<string, unknown>) {
  // Basic system info
  const user = args.user && typeof args.user === "string" ? args.user : JSON.stringify(args.user, null, 2) || 'the user';
  const OS = args.OS && typeof args.OS === "string" ? args.OS : JSON.stringify(args.OS, null, 2) || 'Unknown OS';
  const shellType = args.shell_type && typeof args.shell_type === "string" ? args.shell_type : JSON.stringify(args.shell_type, null, 2) || 'Unknown Shell';
  const dateTime = args.date_time && typeof args.date_time === "string" ? args.date_time : JSON.stringify(args.date_time, null, 2) || new Date().toISOString();
  
  // Environment details
const architecture = args.architecture && typeof args.architecture === "string" ? args.architecture : JSON.stringify(args.architecture, null, 2) || 'Unknown';
const defaultEditor = args.default_editor && typeof args.default_editor === "string" ? args.default_editor : JSON.stringify(args.default_editor, null, 2) || 'Unknown';
const currentDir = args.current_dir && typeof args.current_dir === "string" ? args.current_dir : JSON.stringify(args.current_dir, null, 2) || 'Unknown';
  
  // Command availability
  const hasTree = args.has_tree === 'true';
  const hasGit = args.has_git === 'true';
  const hasJq = args.has_jq === 'true';
  const hasCurl = args.has_curl === 'true';
  const hasWget = args.has_wget === 'true';

  return `
Here is some relevant info that might help you:
OS user: ${user}
Operating System: ${OS}
Shell Type: ${shellType}
Current DateTime: ${dateTime}

Environment Details:
Architecture: ${architecture}
Default Editor: ${defaultEditor}
Current Directory: ${currentDir}

Available Commands:
${hasTree ? '- tree: You can use tree for directory structure visualization\n' : ''}${hasGit ? '- git: You can perform git operations\n' : ''}${hasJq ? '- jq: You can parse and manipulate JSON data\n' : ''}${hasCurl ? '- curl: You can make HTTP requests\n' : ''}${hasWget ? '- wget: You can download files\n' : ''}

Note: When any of these tools are listed as available above, you can use them directly in your commands. If a tool isn't listed, it might still be available, we just never checked for it.`;
}
