import { ParsedSkill } from "./parser.js";

/**
 * Mappings for recommended models per framework.
 */
const MODEL_MAPPING = {
  antigravity: "gemini-3.5-flash",
  claude: "claude-3-5-sonnet",
  codex: "codex-latest",
} as const;

/**
 * Syntax Translation Reference Table JSDoc.
 * 
 * Detailed translation mapping between frameworks:
 * 
 * | Feature / Tool         | Claude (Anthropic)     | Codex (OpenAI)         | Antigravity (Gemini)                                               |
 * | :--------------------- | :--------------------- | :--------------------- | :----------------------------------------------------------------- |
 * | **Framework Id**       | `claude`               | `codex`                | `antigravity`                                                      |
 * | **Recommended Model**  | `claude-3-5-sonnet`    | `codex-latest`         | `gemini-3.5-flash` (or `gemini-3.5-pro` for complex reasoning)     |
 * | **Agent Spawning**     | `spawn_agent`          | `spawn_agent`          | `invoke_subagent`                                                  |
 * | **Agent Scheduling**   | `wait_for_agent`       | `wait_for_agent`       | `schedule`                                                         |
 * | **Pattern Search**     | `grep`                 | `grep`                 | `grep_search`                                                      |
 * | **File Reading**       | `read_file` or `view`  | `read_file` or `view`  | `view_file`                                                        |
 * | **File Writing**       | `write_file`           | `write_file`           | `write_to_file`                                                    |
 * | **OCR / Vision**       | `lancer tesseract`     | `lancer tesseract`     | `utiliser view_file sur l'image` (Gemini is natively multimodal)   |
 */

/**
 * Converts a Markdown skill from one framework to another by translating frontmatter
 * metadata (recommended models, framework ID) and rewriting tool/API syntax
 * in the markdown body sections.
 * 
 * ### Translations Performed:
 * 
 * #### When target is `antigravity`:
 * - `spawn_agent` -> `invoke_subagent`
 * - `wait_for_agent` -> `schedule`
 * - `grep` -> `grep_search`
 * - `read_file` / `view` -> `view_file`
 * - `write_file` -> `write_to_file`
 * - OCR scripts in French (e.g. `lancer tesseract`) -> `view_file` multimodal recommendations.
 * 
 * #### When target is `claude` or `codex`:
 * - `invoke_subagent` -> `spawn_agent`
 * - `schedule` -> `wait_for_agent`
 * - `grep_search` -> `grep`
 * - `view_file` -> `read_file`
 * - `write_to_file` -> `write_file`
 * 
 * @param parsed The parsed skill object containing frontmatter and markdown sections.
 * @param targetFramework The framework to convert the skill to.
 * @returns A new ParsedSkill object adapted for the target framework.
 */
export function convertSkill(
  parsed: ParsedSkill,
  targetFramework: "antigravity" | "claude" | "codex"
): ParsedSkill {
  const targetFrontmatter = { ...parsed.frontmatter };
  targetFrontmatter.framework = targetFramework;
  targetFrontmatter.model = MODEL_MAPPING[targetFramework];

  const targetSections = parsed.sections.map((section) => {
    let content = section.content;

    // Normalize broken markdown links (e.g. [`file.py`](path) -> [file.py](path))
    content = content.replace(/\[`([^`\]]+)`\]\(([^)]+)\)/g, "[$1]($2)");

    if (targetFramework === "antigravity") {
      // 1. Spawning / Execution
      content = content.replace(/\bspawn_agent\b/g, "invoke_subagent");
      content = content.replace(/\bwait_for_agent\b/g, "schedule");

      // 2. Search / Querying
      // Ensure we replace 'grep' as an isolated tool word/call, not a CLI command
      content = content.replace(/`grep`/g, "`grep_search`");
      content = content.replace(/\bgrep\s*\(/g, "grep_search(");
      content = content.replace(/\bgrep\s+tool\b/gi, "grep_search tool");
      // Double replacement cleanup guard
      content = content.replace(/\bgrep_search_search\b/g, "grep_search");

      // 3. File Operations
      content = content.replace(/\bread_file\b/g, "view_file");
      content = content.replace(/`view`/g, "`view_file`");
      content = content.replace(/\bview\s+tool\b/gi, "view_file tool");
      content = content.replace(/\bview\s*\(/g, "view_file(");
      content = content.replace(/\bwrite_file\b/g, "write_to_file");

      // 4. Multimodal & OCR translation (French guidelines)
      content = content.replace(
        /utiliser un script python d'ocr/gi,
        "utiliser directement l'outil view_file (Gemini supporte les formats visuels nativement)"
      );
      content = content.replace(
        /lancer tesseract/gi,
        "utiliser view_file sur l'image"
      );
    } else {
      // Converting BACK to Claude/Codex from Antigravity
      
      // 1. Multimodal & OCR translation back to Claude/Codex (MUST run before replacing view_file with read_file)
      content = content.replace(
        /utiliser directement l'outil view_file \(Gemini supporte les formats visuels nativement\)/gi,
        "utiliser un script python d'ocr"
      );
      content = content.replace(
        /utiliser view_file sur l'image/gi,
        "lancer tesseract"
      );

      // 2. Spawning / Execution
      content = content.replace(/\binvoke_subagent\b/g, "spawn_agent");
      
      // Prevent double replacement / incorrect translation of the common word "schedule"
      content = content.replace(/`schedule`/g, "`wait_for_agent`");
      content = content.replace(/\bschedule\s*\(/g, "wait_for_agent(");
      content = content.replace(/\bschedule\s+tool\b/gi, "wait_for_agent tool");

      // 3. Search
      content = content.replace(/\bgrep_search\b/g, "grep");

      // 4. File Operations
      content = content.replace(/\bview_file\b/g, "read_file");
      content = content.replace(/\bwrite_to_file\b/g, "write_file");
    }

    return {
      ...section,
      content,
    };
  });

  return {
    frontmatter: targetFrontmatter,
    frontmatterRaw: "",
    sections: targetSections,
    rawBody: "",
  };
}
