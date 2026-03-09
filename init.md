# Multi-Agent Adult Interactive Fiction — Claude Code Kickoff Prompt

Copy and paste the following into Claude Code:

---

I want to build a multi-agent adult interactive fiction game using the Anthropic API. Help me scaffold a new project repo.

**Authentication:** This project should use my Claude Max OAuth credentials (via the `claude` CLI login session) rather than a raw API key — so no `.env` API key setup. Use the Anthropic SDK in a way that respects the existing OAuth session.

**Architecture I want:**
- An **orchestrator agent** that manages world state, narrative continuity, and routes to subagents
- **Subagent roles** to start: Narrator, Character (NPC), and World State Manager
- A **system prompt template** for each agent that includes operator-level adult content configuration and maintains consistent tone/setting
- **Conversation history management** so agents share context without ballooning token usage (summarization or sliding window strategy)
- A simple **CLI interface** to start — I'll add a frontend later
- A **README** explaining the overall architecture and how to run it

**Before writing any code, ask me:**
1. Python or Node.js?
2. What is the genre/setting of the game? (fantasy, sci-fi, contemporary, etc.)
3. First-person or second-person narrative perspective?
4. Should NPCs have persistent memory across sessions? If yes, file-based or database?
5. Any specific kinks, themes, or content boundaries I want baked into the system prompts upfront?

Wait for my answers, then scaffold the full project.
