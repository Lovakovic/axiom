# MCP (Model Context Protocol)

A desktop assistant implementation for Linux and macOS users that enables natural interaction with AI through a command-line interface.

## Description

MCP (Model Context Protocol) is a project that aims to create a seamless desktop assistant experience for Linux and macOS users. It provides a CLI interface for interacting with AI assistants, enabling natural language communication and system operations.

## Prerequisites

- Node.js 23.x
- npm (comes with Node.js)
- An Anthropic API key

## Getting Started

1. Clone the repository
```bash
git clone [your-repository-url]
cd mcp
```

2. Install dependencies
```bash
npm install
```

3. Configure environment
```bash
# Create a .env file in the project root and add your Anthropic API key
echo "ANTHROPIC_API_KEY=your_api_key_here" > .env
```

4. Start the application
```bash
# First, start the server
npm run start:server

# Then, in a new terminal, start the agent
npm run start:agent
```

The CLI interface will attach to your terminal, allowing you to interact with the AI assistant through natural language commands.


