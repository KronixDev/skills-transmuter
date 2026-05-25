import fs from "fs";
import yaml from "yaml";

/**
 * Represents a single semantic section within the Markdown Abstract Syntax Tree (AST).
 * Each section maps to a Markdown heading level (e.g., #, ##, ###) and includes the raw
 * text content under it up to the next heading.
 */
export interface MarkdownSection {
  /** The title of the section, stripped of leading hashes and surrounding whitespace. */
  title: string;
  
  /** The markdown heading level (e.g., 1 for '#', 2 for '##', etc.). */
  level: number;
  
  /** The raw markdown text contents belonging to this section, excluding the title line itself. */
  content: string;
}

/**
 * Abstract Syntax Tree (AST) structure of a parsed skill file.
 * 
 * Conceptual Model:
 * ┌────────────────────────────────────────────────────────┐
 * │                     ParsedSkill                        │
 * ├───────────────────┬────────────────────────────────────┤
 * │ frontmatter       │ Key-value pairs parsed from YAML   │
 * ├───────────────────┼────────────────────────────────────┤
 * │ frontmatterRaw    │ Original YAML string (sans ---)    │
 * ├───────────────────┼────────────────────────────────────┤
 * │ rawBody           │ Markdown content after frontmatter │
 * ├───────────────────┼────────────────────────────────────┤
 * │ sections          │ Array of parsed MarkdownSection    │
 * │                   │  ├── [0]: "Introduction" (pre-h1)  │
 * │                   │  ├── [1]: "# Heading 1"            │
 * │                   │  └── ...                           │
 * └───────────────────┴────────────────────────────────────┘
 */
export interface ParsedSkill {
  /** Strongly typed key-value pairs representing configuration fields from the YAML header. */
  frontmatter: Record<string, any>;
  
  /** The raw, unparsed string content of the YAML frontmatter block (excluding delimiters). */
  frontmatterRaw: string;
  
  /** The collection of parsed sections that construct the document's flow and hierarchy. */
  sections: MarkdownSection[];
  
  /** The complete markdown body content excluding the frontmatter block. */
  rawBody: string;
}

/**
 * Loads a skill file from the local filesystem, validates its existence, 
 * reads its content, and runs it through the AST parsing workflow.
 * 
 * @param filePath - The absolute or relative path to the Markdown skill file.
 * @returns A parsed AST representation of the skill file containing the frontmatter and section list.
 * @throws {Error} If the specified file does not exist.
 */
export function parseSkillFile(filePath: string): ParsedSkill {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseSkillContent(content);
}

/**
 * Parses raw text content of a skill Markdown file into a structured AST.
 * 
 * The parser performs a two-stage segmentation:
 * 1. YAML frontmatter extraction using regular expressions targeting the leading '---' block.
 * 2. Markdown heading parsing to slice the remaining body into individual MarkdownSection objects.
 * 
 * @param content - The raw file content of the skill Markdown file.
 * @returns A parsed AST representation of the skill content containing frontmatter and sections.
 */
export function parseSkillContent(content: string): ParsedSkill {
  const safeContent = content || "";
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const match = safeContent.match(frontmatterRegex);

  let frontmatter: Record<string, any> = {};
  let frontmatterRaw = "";
  let rawBody = safeContent;

  if (match) {
    frontmatterRaw = match[1];
    rawBody = safeContent.substring(match[0].length);
    try {
      frontmatter = yaml.parse(frontmatterRaw) || {};
    } catch (e) {
      console.warn("Failed to parse YAML frontmatter, using empty object.", e);
    }
  }

  // Segment Markdown content by lines, looking for header patterns.
  const sections: MarkdownSection[] = [];
  const lines = rawBody.split(/\r?\n/);
  
  let currentTitle = "Introduction";
  let currentLevel = 1;
  let currentLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const codeBlockMatch = line.match(/^\s*(?:```|~~~)/);
    if (codeBlockMatch) {
      inCodeBlock = !inCodeBlock;
    }

    const headerMatch = !inCodeBlock ? line.match(/^(#{1,6})\s+(.*)$/) : null;
    if (headerMatch) {
      // Flush previous section's accumulated content
      if (currentLines.length > 0 || sections.length === 0) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join("\n"),
        });
      }
      currentLevel = headerMatch[1].length;
      currentTitle = headerMatch[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Push final section to list
  if (currentLines.length > 0 || sections.length > 0) {
    sections.push({
      title: currentTitle,
      level: currentLevel,
      content: currentLines.join("\n"),
    });
  }

  return {
    frontmatter,
    frontmatterRaw,
    sections,
    rawBody,
  };
}

/**
 * Reconstructs a formatted Markdown string from a parsed skill AST representation.
 * 
 * This method serializes the frontmatter object back to YAML format, constructs the
 * '---' boundary block, and concatenates all Markdown sections by prepending their
 * title headings back into the flow, preserving overall document structure.
 * 
 * @param parsed - The parsed skill AST representation to stringify.
 * @returns The fully formatted, raw Markdown string with frontmatter and sections.
 */
export function stringifySkill(parsed: ParsedSkill): string {
  const yamlStr = yaml.stringify(parsed.frontmatter).trim();
  const frontmatterPart = `---\n${yamlStr}\n---\n`;
  
  const bodyPart = parsed.sections
    .map((sec) => {
      if (sec.title === "Introduction") {
        return sec.content.trim();
      }
      const hash = "#".repeat(sec.level);
      return `${hash} ${sec.title}\n${sec.content.trim()}`;
    })
    .join("\n\n");

  return `${frontmatterPart}\n${bodyPart}\n`;
}

