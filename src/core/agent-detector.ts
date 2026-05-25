/**
 * Detects if the CLI is currently running inside an AI agent execution environment
 * (such as Claude Code, Codex, or Antigravity) rather than a human interactive shell.
 */
export function isAgentRunning(): boolean {
  // 1. Explicit environment flags
  if (
    process.env.CLAUDE_CODE === "1" ||
    process.env.ANTIGRAVITY === "1" ||
    process.env.CODEX === "1" ||
    process.env.CURSOR_AGENT === "true" ||
    process.env.AI_AGENT === "true"
  ) {
    return true;
  }

  // 2. Generic indicators (e.g. running in automated test or sandbox without normal terminal env)
  if (process.env.NODE_ENV === "test") {
    // Tests might run in non-TTY but we handle them separately.
    return false;
  }

  // 3. Stdin TTY check (if stdin is not interactive, it is highly likely piped/controlled by a bot)
  if (!process.stdin.isTTY) {
    return true;
  }

  // 4. Absence of human terminal variables
  const hasHumanTerminal = 
    process.env.TERM_PROGRAM || 
    process.env.COLORTERM || 
    process.env.SSH_TTY || 
    process.env.TERM;
    
  if (!hasHumanTerminal) {
    return true;
  }

  return false;
}
