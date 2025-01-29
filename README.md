# axiom

Natural language → System commands. No guardrails.

## What is it?

`axiom` is a high-autonomy CLI agent that transforms natural language into system commands and executes them immediately. It's the neural bridge between human intent and machine execution.

## ⚠️ Warning

This tool executes commands with maximum autonomy and minimal safety checks. You need:
- Solid understanding of your system
- Strong AI prompting skills
- Quick Ctrl+C reflexes

Not for production systems or the faint of heart.

## Prerequisites

- Node.js 23.x
- Anthropic API key
- Understanding of prompt engineering
- Trust in AI systems

## Quick Start

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Set up your environment:
- Create a `.env` file in the project root
- Add your Anthropic API key:
```bash
ANTHROPIC_API_KEY=your_key
```

3. Start the agent:
```bash
npm run start:agent
```

4. (Optional but recommended) Let your AI assistant configure itself:
   1. First, start the agent using `npm run start:agent`
   2. Then, give it these instructions:
   ```markdown
   I need you to configure yourself so I can call you from anywhere. Set a permanent alias for yourself, that's the start:agent script in package.json at: /path/to/package.json. I want to be able to run you by just calling `axiom` in terminal.
   ```
   3. 🪄 Watch as it sets everything up automatically!

## Control

The only safety net is your Ctrl+C. Use it wisely:
- During command generation
- During command execution
- Between command sequences

## Effective Usage

Success depends heavily on your prompting skills:
```bash
# Bad prompt (vague, dangerous)
> clean up my system

# Good prompt (specific, bounded context)
> remove all node_modules dirs under ~/projects older than 30 days
```

## Philosophy

`axiom` optimizes for:
- Speed over safety
- Autonomy over confirmation
- Power over protection

For users who trust their AI and value rapid execution over careful consideration.

## License

MIT
