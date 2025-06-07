# CLAUDE.md - Project Documentation for AI Assistants

## Project Overview

**Axiom** (formerly MCP - Model Context Protocol) is a high-autonomy CLI agent that enables natural language interaction with your system through AI. It's designed for Linux and macOS users who want direct, immediate command execution without safety guardrails.

### Key Features
- Natural language to system commands translation
- Multi-agent support (Anthropic, OpenAI, Google Vertex AI/Gemini)
- Real-time streaming responses with interruption handling
- Extensible tool framework for system interactions
- Minimal safety checks for maximum autonomy

## Architecture

### Core Components

1. **Agent Layer** (`src/agent/`)
   - Multi-agent support with providers for Anthropic, OpenAI, and Vertex AI
   - State management using LangGraph for conversation flow
   - Stream processing for real-time responses
   - Interruption handling with three-stage Ctrl+C mechanism

2. **Server Layer** (`src/server/`)
   - MCP protocol implementation
   - Tool management and execution
   - Resource handling (filesystem, images)
   - System prompt generation

3. **CLI Interface** (`src/cli.ts`)
   - Interactive terminal interface
   - Command parsing and execution
   - Dynamic agent switching via `/switch` command
   - State persistence across sessions

### Tool Categories

1. **Command Execution** (`src/server/tools/command_execution/`)
   - Direct shell command execution with terminal management
   - Configurable timeouts and error handling

2. **Filesystem Operations** (`src/server/tools/filesystem/`)
   - File reading, writing, and navigation
   - Directory operations

3. **Search Tools** (`src/server/tools/search/`)
   - Content search within files
   - Pattern matching capabilities

4. **Text Editing** (`src/server/tools/text_editing/`)
   - Fuzzy search for text replacement
   - File content modification

5. **Process Management** (`src/server/tools/process_management/`)
   - System process control and monitoring

6. **Window Management** (`src/server/tools/window_management/`)
   - View and interact with open windows
   - Window content inspection

## Development Guidelines

### Code Style
- TypeScript with strict type checking
- Modular architecture with clear separation of concerns
- Comprehensive error handling and logging
- Follow existing patterns in the codebase

### Testing
```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

### Building and Running
```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the agent
npm run start:agent

# Run in development mode
npm run dev
```

### Environment Setup
Create a `.env` file with:
```bash
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key  # Optional
GOOGLE_APPLICATION_CREDENTIALS=path/to/gc_key.json  # Optional for Vertex AI
```

## Key Technical Details

### State Management
- Uses LangGraph for conversation state machine
- Preserves context across interruptions
- Handles partial responses during Ctrl+C events
- Message types: HumanMessage, AIMessage, ToolMessage

### Interruption Handling
The system handles three interruption scenarios:
1. During tool call generation - preserves partial tool calls
2. During tool execution - converts to plain text messages
3. During response generation - finalizes partial responses

### Multi-Agent Architecture
- Agent Manager handles switching between providers
- Each provider (Anthropic, OpenAI, Vertex AI) has its own implementation
- Conversation context preserved during agent switches
- Provider-specific configurations in respective files

## Common Commands

### Agent Control
- `/switch` - Switch between different AI providers
- `/help` - Display available commands
- `Ctrl+C` - Interrupt current operation (3-stage mechanism)
- `Ctrl+D` or `/exit` - Exit the agent

### Debugging
- Check logs for detailed execution traces
- Use `NODE_ENV=debug` for verbose logging
- Integration tests in `tests/integration/` for testing specific flows

## Important Files

- `src/agent/manager.ts` - Agent management and provider switching
- `src/agent/mcp.client.ts` - Core MCP client implementation
- `src/server/index.ts` - MCP server implementation
- `src/cli.ts` - Main CLI entry point
- `knowledge/` - Project documentation and specifications

## Safety Considerations

⚠️ **WARNING**: This tool executes commands with minimal safety checks. It's designed for:
- Experienced developers who understand system commands
- Non-production environments
- Users comfortable with AI autonomy

Always have Ctrl+C ready to interrupt operations. The tool optimizes for speed and autonomy over safety.

## Future Development

- Remote tool execution capabilities
- Extended system tool integrations
- Enhanced error recovery mechanisms
- Additional AI provider integrations