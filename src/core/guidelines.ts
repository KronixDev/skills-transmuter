/**
 * Guidelines Engine providing optimal practices for creating and refining agent skills
 * on Antigravity 2.0 (Gemini), Claude Code, and Codex frameworks.
 */

const ANTIGRAVITY_GUIDELINES = `# Antigravity 2.0 & Gemini 3.5 Skills Optimization Guidelines

Since Antigravity 2.0 leverages Gemini 3.5 Flash and 3.1 Pro (multimodal, native vision, agentic subagents), follow these strict rules to write perfect skills:

## 1. Absolute Path Resolution
*   **Never use relative paths** (like \`../script.py\`) inside skill process instructions. Antigravity executes tasks under dynamic, isolated or shared subfolders.
*   **Rule**: Always query the workspace path or prefix commands with absolute paths (e.g. \`/Users/kevin/Documents/...\`).

## 2. Multimodal Vision Optimization (\`view_file\`)
*   Gemini has state-of-the-art native vision. **Do not use OCR libraries (like Tesseract) or custom image processing scripts.**
*   **Rule**: Instruct the model to call \`view_file\` directly on visual assets (PDF resumes, video hooks, layout PNGs).
*   **Vision Prompts Rule**: Ask the model to extract visual context using specific JSON schemas or clear tables to avoid hallucination.

## 3. Parallelization & Subagents (\`invoke_subagent\`)
*   To grind through large tasks (e.g. screening 20 candidate profiles or processing 50 assets), **do not run them sequentially in a single context.**
*   **Rule**: Batch items in groups of **5 to 6 max**.
*   **Rule**: Launch specialized subagents concurrently using \`invoke_subagent\`, letting them run in parallel and report back using \`send_message\`.

## 4. Verification Loops
*   Gemini models are fast but can be lazy on long lists. Always instruct the model to run a **terminal command checklist** or compile check (like \`python3 -m py_compile\`) to verify output syntax.
`;

const CLAUDE_GUIDELINES = `# Claude Code Skills Optimization Guidelines

Claude Code relies on Claude 3.5 Sonnet. Follow these guidelines for high-quality skills:

## 1. Three-Level Structure (Progressive Disclosure)
*   **Level 1: YAML Frontmatter (Summary)**: Loaded into system prompt. Must contain triggers and clear kebab-case name.
*   **Level 2: SKILL.md (Process)**: Loaded only when triggered. Detail step-by-step instructions.
*   **Level 3: Resources**: Store heavy scripts, lists or JSON references in separate files (e.g. \`scripts/\` or \`references/\`) and instruct the agent to read them ONLY when executing the task.

## 2. Triggering Specificity
*   Keep the YAML \`description\` precise.
*   Use negative prompts (e.g. "Do NOT trigger this skill for general formatting queries") to conserve tokens.

## 3. Self-Verification Protocol
*   Explicitly instruct Claude to run tests (\`npm test\`, vitest, pytest) and linters (\`eslint\`) before presenting results. If tests fail, it must repair the code.
`;

const CODEX_GUIDELINES = `# Codex Skills Optimization Guidelines

Codex uses the Agent Skills open standard. Follow these guidelines:

## 1. Trigger Keywords
*   Optimize trigger descriptions in the frontmatter. Focus on direct developer tasks (e.g. "Create database view", "Add schema migration").

## 2. Step-by-Step Logic
*   Break down operations into a strict sequential checklist.
*   Use box-drawing characters or plain Markdown lists.

## 3. Tool Mapping
*   Ensure tools like \`spawn_agent\` and \`wait_for_agent\` are declared correctly.
`;

/**
 * Returns the markdown guidelines for a specific target framework.
 */
export function getOptimizationGuidelines(target: string): string {
  const targetLower = target.toLowerCase();
  if (targetLower === "antigravity" || targetLower === "gemini") {
    return ANTIGRAVITY_GUIDELINES;
  }
  if (targetLower === "claude" || targetLower === "claude-code") {
    return CLAUDE_GUIDELINES;
  }
  if (targetLower === "codex" || targetLower === "agents") {
    return CODEX_GUIDELINES;
  }
  return `# General Skills Guidelines\n\nNo specific target framework guidelines found for "${target}".`;
}
