import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAgentRunning } from "../src/core/agent-detector.js";
import { getOptimizationGuidelines } from "../src/core/guidelines.js";

describe("Agent Detection & Guidelines Engine Tests", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    // Reset process env keys
    delete process.env.CLAUDE_CODE;
    delete process.env.ANTIGRAVITY;
    delete process.env.CODEX;
    delete process.env.CURSOR_AGENT;
    delete process.env.AI_AGENT;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("should detect agent running based on environment variables", () => {
    expect(isAgentRunning()).toBe(false);

    process.env.CLAUDE_CODE = "1";
    expect(isAgentRunning()).toBe(true);

    delete process.env.CLAUDE_CODE;
    process.env.ANTIGRAVITY = "1";
    expect(isAgentRunning()).toBe(true);
  });

  it("should retrieve proper optimization guidelines per framework", () => {
    const gemini = getOptimizationGuidelines("antigravity");
    expect(gemini).toContain("Antigravity 2.0 & Gemini 3.5 Skills Optimization Guidelines");
    expect(gemini).toContain("invoke_subagent");
    expect(gemini).toContain("view_file");

    const claude = getOptimizationGuidelines("claude");
    expect(claude).toContain("Claude Code Skills Optimization Guidelines");
    expect(claude).toContain("Three-Level Structure");

    const codex = getOptimizationGuidelines("codex");
    expect(codex).toContain("Codex Skills Optimization Guidelines");

    const unknown = getOptimizationGuidelines("some-framework");
    expect(unknown).toContain("No specific target framework guidelines found");
  });
});
