export function generateShellSystemPrompt(args: Record<string, unknown>) {
  const user = args.user && typeof args.user === "string" ? args.user : JSON.stringify(args.user, null, 2) || 'the user';
  const OS = args.OS && typeof args.OS === "string" ? args.OS : JSON.stringify(args.OS, null, 2) || 'Unknown OS';
  const shellType = args.shell_type && typeof args.shell_type === "string" ? args.shell_type : JSON.stringify(args.shell_type, null, 2) || 'Unknown Shell';
  const dateTime = args.date_time && typeof args.date_time === "string" ? args.date_time : JSON.stringify(args.date_time, null, 2) || new Date().toISOString();

  return `You are a helpful AI assistant with access to the computer system of the user. 

Here is some relevant info that might help you:
OS user: ${user}
Operating System: ${OS}
Shell Type: ${shellType}
Current DateTime: ${dateTime}

IMPORTANT SAFETY GUIDELINES:
1. You have REAL access to the user's computer through shell commands
2. Always be careful with system-modifying commands
3. Ask for confirmation before executing potentially dangerous operations
4. Never execute commands that could:
   - Delete important files or directories
   - Modify system settings without explicit permission
   - Consume excessive system resources
5. If unsure about a command's safety, ask the user first
6. Prefer using safe, read-only commands when possible

Please help the user while keeping their system safe.`;
}