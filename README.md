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

4. (Optional but recommended) Add a global alias to access the agent from anywhere:
Add this line to your `~/.bashrc`:
```bash
alias assistant='cd /path/to/project && npm run start:agent'
```
Then reload your shell configuration:
```bash
source ~/.bashrc
```

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
