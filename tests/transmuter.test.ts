import { describe, it, expect } from "vitest";
import { parseSkillContent, stringifySkill } from "../src/core/parser.js";
import { calculateSemanticRichness, calculateApiModernity } from "../src/core/detector.js";
import { mergeSkills3Way, mergeText3Way } from "../src/core/merge-engine.js";
import { convertSkill } from "../src/core/converter.js";
import { PRESETS, hasSkillsDir, predictWorkspaces } from "../src/commands/migrate.js";
import path from "path";
import fs from "fs";
import os from "os";

describe("Skills Transmuter Core Test Suite", () => {
  
  it("should parse and stringify Markdown skills with YAML frontmatter", () => {
    const raw = [
      "---",
      "name: candidate-sourcing",
      "version: 1.2.0",
      "framework: claude",
      "---",
      "",
      "# Candidate Sourcing",
      "## Instructions",
      "- Match candidate profile to requirements.",
      "- Output HTML report.",
    ].join("\n");

    const parsed = parseSkillContent(raw);
    expect(parsed.frontmatter.name).toBe("candidate-sourcing");
    expect(parsed.frontmatter.version).toBe("1.2.0");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[1].title).toBe("Instructions");

    const recreated = stringifySkill(parsed);
    expect(recreated).toContain("version: 1.2.0");
    expect(recreated).toContain("- Output HTML report.");
  });

  it("should calculate semantic richness index (SRI)", () => {
    const raw = [
      "---",
      "name: test-skill",
      "---",
      "# Test",
      "- Item 1",
      "- Item 2",
    ].join("\n");
    const parsed = parseSkillContent(raw);
    const sri = calculateSemanticRichness(parsed);
    expect(sri).toBeGreaterThan(0); // 2 items * 10 + words
  });

  it("should convert Claude/Codex API tools to Antigravity equivalents", () => {
    const raw = [
      "---",
      "framework: claude",
      "model: claude-3-5-sonnet",
      "---",
      "# Sourcing",
      "First run spawn_agent(web-scraper) and use read_file(path) to inspect. Please lancer tesseract.",
    ].join("\n");

    const parsed = parseSkillContent(raw);
    const converted = convertSkill(parsed, "antigravity");

    expect(converted.frontmatter.framework).toBe("antigravity");
    expect(converted.frontmatter.model).toBe("gemini-3.5-flash");
    expect(converted.sections[1].content).toContain("invoke_subagent(web-scraper)");
    expect(converted.sections[1].content).toContain("view_file(path)");
    expect(converted.sections[1].content).toContain("view_file sur l'image");
  });

  it("should convert Antigravity tools back to Claude equivalents", () => {
    const raw = [
      "---",
      "framework: antigravity",
      "model: gemini-3.5-flash",
      "---",
      "# Sourcing",
      "First run invoke_subagent(web-scraper) and use view_file(path) to inspect.",
    ].join("\n");

    const parsed = parseSkillContent(raw);
    const converted = convertSkill(parsed, "claude");

    expect(converted.frontmatter.framework).toBe("claude");
    expect(converted.frontmatter.model).toBe("claude-3-5-sonnet");
    expect(converted.sections[1].content).toContain("spawn_agent(web-scraper)");
    expect(converted.sections[1].content).toContain("read_file(path)");
  });

  it("should merge conflicts with 3-way text and AST engine", () => {
    const baseRaw = [
      "---",
      "version: 1.0.0",
      "---",
      "# Skill",
      "## Code Stack",
      "- Node.js 18",
    ].join("\n");

    const localRaw = [
      "---",
      "version: 1.0.0",
      "---",
      "# Skill",
      "## Code Stack",
      "- Node.js 18",
      "- Custom user rule added",
    ].join("\n");

    const remoteRaw = [
      "---",
      "version: 1.1.0",
      "---",
      "# Skill",
      "## Code Stack",
      "- Node.js 20",
    ].join("\n");

    const base = parseSkillContent(baseRaw);
    const local = parseSkillContent(localRaw);
    const remote = parseSkillContent(remoteRaw);

    const { merged, hasConflicts } = mergeSkills3Way(base, local, remote);
    expect(merged.frontmatter.version).toBe("1.1.0");
    expect(hasConflicts).toBe(true); // Since local and remote modified the Code Stack section differently
    
    const recreated = stringifySkill(merged);
    expect(recreated).toContain("<<<<<<< LOCAL");
    expect(recreated).toContain("=======");
    expect(recreated).toContain(">>>>>>> REMOTE");
  });

  it("should merge frontmatter keys and section additions/deletions/conflicts semantically", () => {
    const baseRaw = [
      "---",
      "version: 1.0.0",
      "framework: claude",
      "onlyBase: true",
      "---",
      "# Skill",
      "## Introduction",
      "Base intro content.",
    ].join("\n");

    const localRaw = [
      "---",
      "version: 1.0.0",
      "framework: antigravity",
      "onlyLocal: yes",
      "---",
      "# Skill",
      "## Introduction",
      "Base intro content.",
      "## Local Added",
      "New local section.",
    ].join("\n");

    const remoteRaw = [
      "---",
      "version: 1.1.0",
      "framework: claude",
      "onlyRemote: yes",
      "---",
      "# Skill",
      "## Introduction",
      "Base intro content.",
      "## Remote Added",
      "New remote section.",
    ].join("\n");

    const base = parseSkillContent(baseRaw);
    const local = parseSkillContent(localRaw);
    const remote = parseSkillContent(remoteRaw);

    const { merged, hasConflicts } = mergeSkills3Way(base, local, remote);
    expect(hasConflicts).toBe(false);
    expect(merged.frontmatter.version).toBe("1.1.0"); // version: remote preferred
    expect(merged.frontmatter.framework).toBe("antigravity"); // framework: local preferred since changed
    expect(merged.frontmatter.onlyLocal).toBe("yes");
    expect(merged.frontmatter.onlyRemote).toBe("yes");
    expect(merged.frontmatter.onlyBase).toBeUndefined(); // deleted/not-present since not in local/remote modifications

    const titles = merged.sections.map(s => s.title);
    expect(titles).toContain("Local Added");
    expect(titles).toContain("Remote Added");
  });


  it("should resolve presets configuration properly", () => {
    expect(PRESETS).toBeDefined();
    expect(PRESETS.DevLab).toContain("DevLab");
    expect(PRESETS.Documents).toContain("Documents");
  });

  it("should detect directories with skills folders correctly", () => {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "transmuter-test-"));
    try {
      const skillsDir = path.join(tempBaseDir, ".antigravity", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      expect(hasSkillsDir(tempBaseDir)).toBe(true);
      expect(hasSkillsDir(path.join(tempBaseDir, "src"))).toBe(false);
    } finally {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it("should predict workspaces correctly from project path siblings", () => {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "transmuter-test-"));
    try {
      const project1 = path.join(tempBaseDir, "Project1");
      const project2 = path.join(tempBaseDir, "Project2");
      fs.mkdirSync(path.join(project1, ".claude", "skills"), { recursive: true });
      fs.mkdirSync(path.join(project2, ".antigravity", "skills"), { recursive: true });
      
      const predicted = predictWorkspaces(project1);
      expect(predicted).toContain(project1);
      expect(predicted).toContain(project2);
    } finally {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

});
