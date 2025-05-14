# MCP (Model Context Protocol) Desktop Assistant

## Project Overview
MCP is a sophisticated desktop assistant designed primarily for Linux and macOS users, enabling natural language interaction with AI through a command-line interface. The project now uniquely supports multi-agent functionality, allowing dynamic switching between agents (OpenAI and Anthropic) to optimize performance based on task requirements.

## Core Technologies

### Primary Framework
- **Node.js v23**: The project is built on Node.js, leveraging its asynchronous event-driven architecture for efficient stream processing and real-time interaction handling.
- **LangChain & LangGraph**: The foundation remains built on LangChain and LangGraph, providing structured conversation flows, tool integration, state management for complex interactions, and stream-based response handling. Recent enhancements include improved error recovery and multi-agent support.

### Key Components
1. **Model Context Protocol (MCP)**
   - Implements standardized tool execution, with ongoing developments for remote tool execution capabilities.
   - Integrates AI agents with system tools seamlessly, including the newly added view-image tool for improved multimedia handling.

2. **Agent Architecture**
   - Supports multiple agents with dynamic switching, ensuring optimal performance and flexibility.
   - Utilizes an enhanced state machine via LangGraph, offering robust conversation context preservation and efficient recovery from interruptions.

3. **Server Components**
   - **Resource Management:** Efficient handling of file system interactions and resource loading.
   - **Tool Management:** Streamlined integration of system tools with strict schema validation and improved error handling.
   - **Prompt Management:** Enhanced system prompt generation that incorporates updated system context and multi-agent messaging.

## Technical Architecture

### Core Components
1. **Server Layer (`src/server/`):**
   - Updated MCP protocol with extended capabilities.
   - Enhanced management of system resources and tool execution with robust error recovery.
   - Improved prompt generation facilitating dynamic agent selection.

2. **Agent Layer (`src/agent/`):**
   - Incorporates multi-agent support with dynamic switching between providers.
   - Robust conversation and state management with improved interruption recovery mechanisms.
   - Advanced streaming response integration that cleanly separates text outputs from tool execution events.

3. **Client Layer:**
   - Enhanced CLI interface supporting dynamic agent switching and improved command execution.
   - Superior state persistence and input queuing that guarantee smooth user interactions and display of responses.

## Tools and Capabilities
1. **System Tools**
   - Shell Command Execution
   - File System Navigation
   - Image Viewing (via the new view-image tool)
   - Resource Management

2. **Safety Features**
   - Rigorous command validation and systematic error handling.
   - Enhanced system protection and streamlined recovery after interruptions, including refined reconnection to preserve conversation context.

## Implementation Details

### State Management
- Employs an enhanced LangGraph-driven state machine to maintain robust conversation context.
- Ensures minimal state loss with improved interruption recovery and dynamic agent switching.

### Stream Processing
- Implements advanced streaming responses with clear separation of text outputs and tool execution events.
- Capable of concurrently handling multiple stream events with improved reliability.

## Technical Requirements
- Node.js 23.x
- Anthropic and OpenAI API keys
- Linux or macOS operating systems
- npm/yarn package manager

## Future Capabilities
- Remote tool execution through expanded MCP protocol features.
- Further integration of system tools and extended support for additional capabilities.
- Enhanced logging and debugging features to better diagnose errors.
- Continued refinement of multi-agent operation for improved performance.

## Architecture Diagram
```
[User CLI Interface]
        ↓
[Enhanced Agent (Multi-Agent Support)]
        ↓
[Refined MCP Protocol Layer]
        ↓
[System Tools & Resources]
```

## Key Features
1. Natural language command execution with dynamic multi-agent support.
2. Robust system-level access combined with refined error handling and recovery.
3. Structured conversation flows with advanced state management.
4. Real-time streaming response handling with improved separation of events.
5. Extensible tool framework and enhanced logging for detailed debugging and error analysis.

## Development Status
The current implementation focuses on enhancing multi-agent functionalities, robust tool integrations, CLI improvements, and seamless state management. Future developments will extend support for remote execution capabilities and further optimize system performance.
