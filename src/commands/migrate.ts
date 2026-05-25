import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import os from "os";
import readline from "readline";
import { parseSkillFile, parseSkillContent, stringifySkill } from "../core/parser.js";
import { evaluateFreshness, isMoreUpToDate, FreshnessScore } from "../core/detector.js";
import { loadLockfile, saveLockfile, computeHash, mergeSkills3Way, Lockfile } from "../core/merge-engine.js";
import { convertSkill } from "../core/converter.js";
import { Theme, printThemeBanner } from "../core/theme.js";
import { isAgentRunning } from "../core/agent-detector.js";

/**
 * The target framework type for skill migration.
 */
export type TargetFramework = "antigravity" | "claude" | "codex";

/**
 * The strategy type to determine the freshest skill version.
 */
export type MigrationStrategy = "freshest" | "force-codex" | "force-claude" | "force-antigravity";

/**
 * Options for the migrate command.
 */
export interface MigrateOptions {
  /** The target directory path to run the migration on. */
  dir?: string;
  /** Name of a predefined preset directory. */
  preset?: string;
  /** The target destination framework. */
  target?: TargetFramework;
  /** The strategy to use when determining the freshest skill. */
  strategy?: MigrationStrategy;
  /** Auto-confirm all prompts (non-interactive mode). */
  yes?: boolean;
  /** Format of log messages: plain text or JSON. */
  logFormat?: "plain" | "json";
  /** Print action plan without writing files. */
  dryRun?: boolean;
  /** Comma-separated list of skill names to migrate. */
  skills?: string;
}

/**
 * Representing a row in the skill audit table.
 */
export interface SkillRow {
  /** The unique name of the skill. */
  name: string;
  /** Cell display string for Claude. */
  claudeVal: string;
  /** Cell display string for Codex. */
  codexVal: string;
  /** Cell display string for Antigravity. */
  antigravityVal: string;
  /** Path to the best source version found. */
  bestSourcePath?: string;
  /** Freshness score of the best source version found. */
  bestSourceScore?: FreshnessScore;
  /** Freshness score of the Claude version. */
  claudeScore?: FreshnessScore;
  /** Freshness score of the Codex version. */
  codexScore?: FreshnessScore;
  /** Freshness score of the Antigravity version. */
  antigravityScore?: FreshnessScore;
}

/**
 * Representing the migration status of a single skill.
 */
export interface SkillStatus {
  /** The name of the skill. */
  name: string;
  /** The path where the migrated skill will be saved. */
  targetPath: string;
  /** The name of the best source framework (e.g., 'claude'). */
  bestSource: string;
  /** The path to the best source file. */
  bestSourcePath?: string;
  /** The freshness score of the best source file. */
  bestSourceScore?: FreshnessScore;
  /** The freshness score of the existing target file (if any). */
  targetScore?: FreshnessScore;
  /** The status of the sync operation (NEW, UP_TO_DATE, etc.). */
  status: "NEW" | "UP_TO_DATE" | "OUTDATED" | "LOCAL_MODIFIED" | "CONFLICT";
}

/**
 * Logger utility for formatting output to plain text or JSON.
 */
class GrepLogger {
  /**
   * Creates an instance of GrepLogger.
   * @param format - The output log format: 'plain' or 'json'.
   */
  constructor(private format: "plain" | "json" = "plain") {}

  /**
   * Logs an informational message.
   * @param msg - The log message.
   * @param metadata - Optional key-value pairs for JSON output.
   */
  info(msg: string, metadata?: Record<string, any>): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "info", message: msg, ...metadata }));
    } else {
      console.log(`[INFO] ${msg}`);
    }
  }

  /**
   * Logs a warning message.
   * @param msg - The log message.
   * @param metadata - Optional key-value pairs for JSON output.
   */
  warn(msg: string, metadata?: Record<string, any>): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "warn", message: msg, ...metadata }));
    } else {
      console.log(chalk.yellow(`[WARN] ${msg}`));
    }
  }

  /**
   * Logs an error message.
   * @param msg - The log message.
   * @param metadata - Optional key-value pairs for JSON output.
   */
  error(msg: string, metadata?: Record<string, any>): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "error", message: msg, ...metadata }));
    } else {
      console.log(chalk.red(`[ERROR] ${msg}`));
    }
  }

  /**
   * Logs that a skill was found during scanning.
   * @param skillName - The name of the skill.
   * @param versions - Dictionary of framework version timestamps.
   */
  scanFound(skillName: string, versions: Record<string, string>): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "info", type: "scan_found", skill: skillName, versions }));
    } else {
      const verStr = Object.entries(versions).map(([k, v]) => `${k}:${v}`).join(", ");
      console.log(`[SCAN:FOUND] ${skillName} | ${verStr}`);
    }
  }

  /**
   * Logs the start of a synchronization operation.
   * @param skillName - The name of the skill.
   * @param status - The skill status.
   * @param source - The source framework.
   * @param target - The destination framework.
   */
  syncStart(skillName: string, status: string, source: string, target: string): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "info", type: "sync_start", skill: skillName, status, source, target }));
    } else {
      console.log(`[SYNC:START] ${skillName} [${status}] from ${source} to ${target}`);
    }
  }

  /**
   * Logs a successful synchronization operation.
   * @param skillName - The name of the skill.
   * @param status - The skill status.
   * @param targetPath - The destination path where the skill was written.
   */
  syncSuccess(skillName: string, status: string, targetPath: string): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "info", type: "sync_success", skill: skillName, status, targetPath }));
    } else {
      console.log(chalk.green(`[SYNC:SUCCESS] ${skillName} [${status}] -> ${targetPath}`));
    }
  }

  /**
   * Logs a synchronization conflict.
   * @param skillName - The name of the skill.
   * @param targetPath - The destination path where the conflict was written.
   */
  syncConflict(skillName: string, targetPath: string): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "warn", type: "sync_conflict", skill: skillName, targetPath }));
    } else {
      console.log(chalk.red(`[SYNC:CONFLICT] ${skillName} -> ${targetPath} (merged with conflict markers)`));
    }
  }

  /**
   * Logs the final summary of the sync operation.
   * @param summary - Object containing processed and conflict counts.
   */
  syncCompleted(summary: { processed: number; conflicts: number }): void {
    if (this.format === "json") {
      console.log(JSON.stringify({ level: "info", type: "sync_completed", ...summary }));
    } else {
      console.log(chalk.bold.green(`[SYNC:COMPLETED] Processed: ${summary.processed}, Conflicts: ${summary.conflicts}`));
    }
  }
}

/**
 * Resolves a home-relative path (starting with '~') to an absolute path.
 * 
 * @param pStr - The path string possibly containing a tilde.
 * @returns The fully resolved path string.
 */
function resolveHome(pStr: string): string {
  if (pStr.startsWith("~")) {
    return path.join(os.homedir(), pStr.slice(1));
  }
  return pStr;
}

/**
 * Preset directory shortcuts mapped to absolute paths.
 */
export const PRESETS: Record<string, string> = {
  DevLab: resolveHome("~/Documents/DevLab"),
  Documents: resolveHome("~/Documents"),
};

/**
 * Checks if a project directory contains a skills folder for any framework.
 * 
 * @param dirPath - The project directory path.
 * @returns True if a skills directory exists, false otherwise.
 */
export function hasSkillsDir(dirPath: string): boolean {
  const candidates = [
    path.join(dirPath, ".agents", "skills"),
    path.join(dirPath, ".claude", "skills"),
    path.join(dirPath, ".antigravity", "skills"),
    path.join(dirPath, ".kilocode", "skills"),
  ];
  return candidates.some((c) => fs.existsSync(c));
}

/**
 * Scans a preset directory for active project folders that contain skills.
 * Handles potential file access errors cleanly.
 * 
 * @param presetDir - The preset directory path.
 * @returns An array of subproject directory names containing skills.
 */
export function scanPresetProjects(presetDir: string): string[] {
  const activeProjects: string[] = [];
  try {
    const items = fs.readdirSync(presetDir);
    for (const item of items) {
      const fullPath = path.join(presetDir, item);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        continue;
      }
      if (hasSkillsDir(fullPath)) {
        activeProjects.push(item);
      } else {
        try {
          const subItems = fs.readdirSync(fullPath);
          for (const subItem of subItems) {
            const subPath = path.join(fullPath, subItem);
            if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory()) {
              if (hasSkillsDir(subPath)) {
                activeProjects.push(path.join(item, subItem));
              }
            }
          }
        } catch {
          // Silent catch for nested subfolder read errors
        }
      }
    }
  } catch {
    // Silent catch for main directory read errors
  }
  return activeProjects;
}

/**
 * Predicts potential workspaces around the current project root, parent directories,
 * and common user directories like Documents, Desktop, Developer, etc.
 * 
 * @param projectRoot - The current project root directory.
 * @returns An array of absolute paths to folders containing a skills directory.
 */
export function predictWorkspaces(projectRoot: string): string[] {
  const predicted = new Set<string>();

  // 1. Current directory
  if (hasSkillsDir(projectRoot)) {
    predicted.add(projectRoot);
  }

  // 2. Siblings of current directory
  try {
    const parent = path.dirname(projectRoot);
    if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
      const items = fs.readdirSync(parent);
      for (const item of items) {
        const fullPath = path.join(parent, item);
        if (fs.statSync(fullPath).isDirectory() && hasSkillsDir(fullPath)) {
          predicted.add(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors reading parent directory siblings
  }

  // 3. Sibling of parent (two levels up siblings)
  try {
    const grandparent = path.dirname(path.dirname(projectRoot));
    if (fs.existsSync(grandparent) && fs.statSync(grandparent).isDirectory() && grandparent !== os.homedir() && grandparent !== "/") {
      const items = fs.readdirSync(grandparent);
      for (const item of items) {
        const fullPath = path.join(grandparent, item);
        if (fs.statSync(fullPath).isDirectory()) {
          if (hasSkillsDir(fullPath)) {
            predicted.add(fullPath);
          } else {
            try {
              const subItems = fs.readdirSync(fullPath);
              for (const sub of subItems) {
                const subPath = path.join(fullPath, sub);
                if (fs.statSync(subPath).isDirectory() && hasSkillsDir(subPath)) {
                  predicted.add(subPath);
                }
              }
            } catch {
              // Ignore errors reading grandparent sub-items
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors reading grandparent directory
  }

  // 4. Common locations in Home directory
  const home = os.homedir();
  const searchDirs = [
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    path.join(home, "Developer"),
    path.join(home, "Development"),
    path.join(home, "Projects"),
    path.join(home, "workspace"),
    path.join(home, "src"),
  ];

  for (const dir of searchDirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          if (fs.statSync(fullPath).isDirectory()) {
            if (hasSkillsDir(fullPath)) {
              predicted.add(fullPath);
            }
            try {
              const subItems = fs.readdirSync(fullPath);
              for (const sub of subItems) {
                const subPath = path.join(fullPath, sub);
                if (fs.statSync(subPath).isDirectory() && hasSkillsDir(subPath)) {
                  predicted.add(subPath);
                }
              }
            } catch {
              // Ignore sub-directory read errors
            }
          }
        }
      } catch {
        // Ignore home folder search errors
      }
    }
  }

  return Array.from(predicted).map((pPath) => path.resolve(pPath));
}

/**
 * Representing a choice item in a Clack select prompt.
 */
interface ClackChoice<T> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Interactively browses the directory structure starting from a given directory.
 * 
 * @param startDir - The starting directory path.
 * @returns A promise that resolves to the selected directory path, or empty string if cancelled.
 */
async function browseDirectory(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  
  while (true) {
    let subDirs: string[] = [];
    try {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      subDirs = items
        .filter((item) => item.isDirectory() && !item.name.startsWith("."))
        .map((item) => item.name)
        .sort();
    } catch {
      p.log.warn(`Cannot read directory: ${currentDir}`);
    }

    const options: ClackChoice<string>[] = [
      { value: "SELECT", label: `👉 [Select: ${path.basename(currentDir) || currentDir}]`, hint: `Use this workspace` },
      { value: "GO_UP", label: "📁 .. (Go up)", hint: path.dirname(currentDir) }
    ];

    for (const sub of subDirs) {
      options.push({
        value: sub,
        label: `📁 ${sub}/`,
        hint: `Enter folder`
      });
    }

    const choice = await p.select({
      message: `Current location: ${chalk.cyan(currentDir)}`,
      options,
    });

    if (p.isCancel(choice)) {
      return "";
    }

    if (choice === "SELECT") {
      return currentDir;
    } else if (choice === "GO_UP") {
      currentDir = path.dirname(currentDir);
    } else {
      currentDir = path.join(currentDir, choice as string);
    }
  }
}

/**
 * Gets the workspace path interactively by prompting the user with options
 * (auto-detected workspaces, current directory, preset, browser, manual entry).
 * 
 * @param projectRoot - The current project root directory.
 * @param presetOpt - An optional preset name (e.g. "DevLab").
 * @returns A promise that resolves to the selected absolute workspace directory path.
 */
async function getWorkspacePathInteractive(projectRoot: string, presetOpt?: string): Promise<string> {
  let selectedPreset = presetOpt;
  if (!selectedPreset) {
    const predicted = predictWorkspaces(projectRoot);
    const options: ClackChoice<string>[] = [];
    
    if (predicted.length > 0) {
      options.push({
        value: "predicted",
        label: `✨ Auto-Detected Workspaces (${predicted.length} found)`,
        hint: "Recommended"
      });
    }

    options.push(
      { value: "current", label: `📂 Current Directory (${projectRoot})` },
      { value: "browse", label: "🔍 Interactive Browser (browse dirs)" },
      { value: "manual", label: "⌨️  Enter custom path manually..." },
      { value: "DevLab", label: `📂 Preset: DevLab (${PRESETS.DevLab})` },
      { value: "Documents", label: `📂 Preset: Documents (${PRESETS.Documents})` }
    );

    const choice = await p.select({
      message: "Select workspace location strategy:",
      options,
    });

    if (p.isCancel(choice)) return "";

    if (choice === "predicted") {
      const projChoice = await p.select({
        message: "Select from auto-detected workspaces:",
        options: predicted.map((pPath) => ({
          value: pPath,
          label: `📦 ${path.basename(pPath)}`,
          hint: pPath
        }))
      });
      return p.isCancel(projChoice) ? "" : (projChoice as string);
    }

    if (choice === "current") return projectRoot;
    if (choice === "browse") return browseDirectory(projectRoot);
    if (choice === "manual") {
      const manual = await p.text({
        message: "Enter custom workspace directory path:",
        placeholder: projectRoot,
        defaultValue: projectRoot,
        validate(val) {
          if (!val) return "Path cannot be empty.";
          if (!fs.existsSync(val)) return "Path does not exist.";
          if (!fs.statSync(val).isDirectory()) return "Path is not a directory.";
        }
      });
      return p.isCancel(manual) ? "" : path.resolve(manual);
    }
    selectedPreset = choice as string;
  }

  const presetDir = PRESETS[selectedPreset];
  if (!fs.existsSync(presetDir)) {
    p.note(chalk.red(`Preset directory not found: ${presetDir}`));
    const manual = await p.text({
      message: "Please enter custom workspace directory path:",
      validate(val) {
        if (!val || !fs.existsSync(val)) return "Valid path is required.";
      }
    });
    return p.isCancel(manual) ? "" : path.resolve(manual);
  }

  const spinner = p.spinner();
  spinner.start(`Scanning preset directory: ${presetDir}...`);
  const projects = scanPresetProjects(presetDir);
  spinner.stop("Scan completed.");

  if (projects.length === 0) {
    p.note(chalk.yellow(`No active skill-based projects found in preset: ${presetDir}`));
    const manual = await p.text({
      message: "Enter relative or absolute project path:",
    });
    return p.isCancel(manual) ? "" : path.resolve(presetDir, manual);
  }

  const selectedProj = await p.select({
    message: `Select a project from ${selectedPreset}:`,
    options: [
      ...projects.map((proj) => ({ value: proj, label: `📦 ${proj}` })),
      { value: "__manual__", label: "⌨️  Enter custom relative path..." }
    ]
  });

  if (p.isCancel(selectedProj)) return "";

  if (selectedProj === "__manual__") {
    const rel = await p.text({
      message: "Enter subfolder path relative to preset directory:",
    });
    return p.isCancel(rel) ? "" : path.resolve(presetDir, rel);
  }

  return path.join(presetDir, selectedProj);
}

/**
 * Resolves the workspace path for the migration operation.
 * Handles auto-confirm/agent modes and interactive prompting.
 * 
 * @param projectRoot - The root directory of the current project.
 * @param options - The migration options passed via the CLI.
 * @param isAgent - Whether an agent is currently running.
 * @param autoConfirm - Whether auto-confirm (yes flag) is active.
 * @param logger - The logger instance.
 * @returns The resolved absolute workspace root path.
 */
async function resolveWorkspacePath(
  projectRoot: string,
  options: MigrateOptions,
  isAgent: boolean,
  autoConfirm: boolean,
  logger: GrepLogger
): Promise<string> {
  let selectedRoot = "";

  if (autoConfirm || isAgent) {
    let baseDir = projectRoot;
    if (options.preset && PRESETS[options.preset]) {
      baseDir = PRESETS[options.preset];
    }
    selectedRoot = options.dir ? path.resolve(baseDir, options.dir) : baseDir;
    if (!fs.existsSync(selectedRoot) || !fs.statSync(selectedRoot).isDirectory()) {
      logger.error(`Workspace directory does not exist or is not a directory: ${selectedRoot}`);
      process.exit(1);
    }
    if (autoConfirm) {
      logger.info(`Scanning workspace: ${selectedRoot}`);
    } else {
      console.log(`\n### 📦 Scanning workspace: \`${selectedRoot}\``);
    }
  } else {
    printThemeBanner();
    selectedRoot = await getWorkspacePathInteractive(projectRoot, options.preset);
    if (!selectedRoot) {
      p.outro("Operation cancelled.");
      return "";
    }
  }
  return selectedRoot;
}

/**
 * Scans a workspace root directory for existing skill directories across all frameworks
 * and returns the set of skill names that contain a `SKILL.md` file.
 * 
 * @param workspaceRoot - The root path of the workspace to scan.
 * @returns A set of unique skill names that contain a `SKILL.md` in at least one framework.
 */
export function scanSkills(workspaceRoot: string): Set<string> {
  const claudeSkillsDir = path.join(workspaceRoot, ".claude", "skills");
  const codexSkillsDir = path.join(workspaceRoot, ".agents", "skills");
  const kilocodeSkillsDir = path.join(workspaceRoot, ".kilocode", "skills");
  const antigravitySkillsDir = path.join(workspaceRoot, ".antigravity", "skills");

  const allSkillNames = new Set<string>();

  const scanDir = (dir: string) => {
    if (fs.existsSync(dir)) {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (fs.statSync(path.join(dir, item)).isDirectory()) {
            allSkillNames.add(item);
          }
        }
      } catch {
        // Silent catch for missing directories
      }
    }
  };

  scanDir(claudeSkillsDir);
  scanDir(codexSkillsDir);
  scanDir(kilocodeSkillsDir);
  scanDir(antigravitySkillsDir);

  const filteredSkillNames = new Set<string>();
  for (const name of allSkillNames) {
    const hasSkillFile =
      fs.existsSync(path.join(claudeSkillsDir, name, "SKILL.md")) ||
      fs.existsSync(path.join(codexSkillsDir, name, "SKILL.md")) ||
      fs.existsSync(path.join(kilocodeSkillsDir, name, "SKILL.md")) ||
      fs.existsSync(path.join(antigravitySkillsDir, name, "SKILL.md"));

    if (hasSkillFile) {
      filteredSkillNames.add(name);
    }
  }

  return filteredSkillNames;
}

/**
 * Builds an audit matrix comparing the versions/freshness of all skills across the different frameworks.
 * 
 * @param workspaceRoot - The root path of the workspace.
 * @param skillNames - The set of skill names to audit.
 * @param logger - The logger instance for recording scanned skills.
 * @param autoConfirm - Whether auto-confirm is enabled (for machine-readable logs).
 * @returns An array of SkillRow objects representing the audit matrix.
 */
export function buildAuditMatrix(
  workspaceRoot: string,
  skillNames: Set<string>,
  logger: GrepLogger,
  autoConfirm: boolean
): SkillRow[] {
  const claudeSkillsDir = path.join(workspaceRoot, ".claude", "skills");
  const codexSkillsDir = path.join(workspaceRoot, ".agents", "skills");
  const kilocodeSkillsDir = path.join(workspaceRoot, ".kilocode", "skills");
  const antigravitySkillsDir = path.join(workspaceRoot, ".antigravity", "skills");

  const matrix: SkillRow[] = [];

  for (const name of skillNames) {
    const claudePathStr = claudePath(workspaceRoot, name);
    const codexPathStr = fs.existsSync(path.join(codexSkillsDir, name, "SKILL.md"))
      ? path.join(codexSkillsDir, name, "SKILL.md")
      : path.join(kilocodeSkillsDir, name, "SKILL.md");
    const antigravityPathStr = path.join(antigravitySkillsDir, name, "SKILL.md");

    const hasClaude = fs.existsSync(claudePathStr);
    const hasCodex = fs.existsSync(codexPathStr);
    const hasAntigravity = fs.existsSync(antigravityPathStr);

    let claudeVal = Theme.statusMissing();
    let codexVal = Theme.statusMissing();
    let antigravityVal = Theme.statusMissing();

    let claudeScore: FreshnessScore | undefined;
    let codexScore: FreshnessScore | undefined;
    let antigravityScore: FreshnessScore | undefined;

    if (hasClaude) {
      claudeScore = evaluateFreshness(claudePathStr);
    }
    if (hasCodex) {
      codexScore = evaluateFreshness(codexPathStr);
    }
    if (hasAntigravity) {
      antigravityScore = evaluateFreshness(antigravityPathStr);
    }

    // Determine which format is the freshest
    let freshestKey = "";
    const activeScores = [
      { key: "claude", score: claudeScore },
      { key: "codex", score: codexScore },
      { key: "antigravity", score: antigravityScore },
    ].filter((s): s is { key: string; score: FreshnessScore } => s.score !== undefined);

    if (activeScores.length > 0) {
      let best = activeScores[0];
      for (let i = 1; i < activeScores.length; i++) {
        if (isMoreUpToDate(best.score, activeScores[i].score)) {
          best = activeScores[i];
        }
      }
      freshestKey = best.key;
    }

    const formatDateLocal = (date: Date): string => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const getCellDisplay = (score: FreshnessScore, key: string): string => {
      const dateStr = formatDateLocal(score.gitDate);
      return freshestKey === key
        ? chalk.bold.green(`⭐ ${dateStr}`)
        : chalk.dim.yellow(dateStr);
    };

    if (hasClaude && claudeScore) {
      claudeVal = getCellDisplay(claudeScore, "claude");
    }
    if (hasCodex && codexScore) {
      codexVal = getCellDisplay(codexScore, "codex");
    }
    if (hasAntigravity && antigravityScore) {
      antigravityVal = getCellDisplay(antigravityScore, "antigravity");
    }

    if (autoConfirm) {
      logger.scanFound(name, {
        claude: claudeScore ? formatDateLocal(claudeScore.gitDate) : "missing",
        codex: codexScore ? formatDateLocal(codexScore.gitDate) : "missing",
        antigravity: antigravityScore ? formatDateLocal(antigravityScore.gitDate) : "missing",
      });
    }

    matrix.push({
      name,
      claudeVal,
      codexVal,
      antigravityVal,
      claudeScore,
      codexScore,
      antigravityScore,
    });
  }

  return matrix;
}

/**
 * Displays the unified skills audit matrix in a table format.
 * 
 * @param matrix - The skill audit matrix to display.
 * @param isAgent - Whether the command is executed by an agent.
 * @param autoConfirm - Whether to skip interactive displays (e.g. in non-interactive/yes mode).
 */
export function displayAuditMatrix(
  matrix: SkillRow[],
  isAgent: boolean,
  autoConfirm: boolean
): void {
  if (autoConfirm) return;

  if (isAgent) {
    const cleanVal = (val: string) => val.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
    console.log("\n### 📊 Unified Skills Audit Matrix\n");
    console.log("| Skill Name | Claude Code | Codex | Antigravity |");
    console.log("| :--- | :--- | :--- | :--- |");
    for (const m of matrix) {
      console.log(`| **${m.name}** | ${cleanVal(m.claudeVal)} | ${cleanVal(m.codexVal)} | ${cleanVal(m.antigravityVal)} |`);
    }
    console.log("");
  } else {
    const colWidthName = 24;
    const colWidthClaude = 22;
    const colWidthCodex = 22;
    const colWidthAnti = 22;

    const pad = (str: string, len: number) => {
      const cleanStr = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
      const spaces = len - cleanStr.length;
      return str + " ".repeat(Math.max(0, spaces));
    };

    const headerRow = `${Theme.border("│")} ${pad(chalk.bold.cyan("Skill Name"), colWidthName)} ${Theme.border("│")} ${pad(
      chalk.bold.magenta("Claude Code"),
      colWidthClaude
    )} ${Theme.border("│")} ${pad(chalk.bold.yellow("Codex"), colWidthCodex)} ${Theme.border("│")} ${pad(chalk.bold.green("Antigravity"), colWidthAnti)} ${Theme.border("│")}`;

    const divider = Theme.border(`├${"─".repeat(colWidthName + 2)}┼${"─".repeat(colWidthClaude + 2)}┼${"─".repeat(
      colWidthCodex + 2
    )}┼${"─".repeat(colWidthAnti + 2)}┤`);

    const topBorder = Theme.border(`┌${"─".repeat(colWidthName + 2)}┬${"─".repeat(colWidthClaude + 2)}┬${"─".repeat(
      colWidthCodex + 2
    )}┬${"─".repeat(colWidthAnti + 2)}┐`);

    const bottomBorder = Theme.border(`└${"─".repeat(colWidthName + 2)}┴${"─".repeat(colWidthClaude + 2)}┴${"─".repeat(
      colWidthCodex + 2
    )}┴${"─".repeat(colWidthAnti + 2)}┘`);

    const gridRows = matrix
      .map(
        (m) =>
          `${Theme.border("│")} ${pad(chalk.bold.white(m.name), colWidthName)} ${Theme.border("│")} ${pad(m.claudeVal, colWidthClaude)} ${Theme.border("│")} ${pad(
            m.codexVal,
            colWidthCodex
          )} ${Theme.border("│")} ${pad(m.antigravityVal, colWidthAnti)} ${Theme.border("│")}`
      )
      .join("\n");

    const fullGrid = [topBorder, headerRow, divider, gridRows, bottomBorder].join("\n");
    p.note(fullGrid, "Unified Skills Audit Matrix");
  }
}

/**
 * Determines the migration strategy to use (freshest, force-codex, etc.).
 * 
 * @param options - The CLI options.
 * @param isAgent - Whether an agent is running.
 * @param autoConfirm - Whether auto-confirm is enabled.
 * @returns A promise that resolves to the chosen MigrationStrategy.
 */
async function determineStrategy(
  options: MigrateOptions,
  isAgent: boolean,
  autoConfirm: boolean
): Promise<MigrationStrategy> {
  if (options.strategy) {
    return options.strategy;
  }
  if (autoConfirm || isAgent) {
    return "freshest";
  }

  const stratChoice = await p.select({
    message: "Select your migration strategy (how to determine the source version):",
    options: [
      { value: "freshest", label: "Smart Freshest (SemVer + Git chronology + AST complexity)" },
      { value: "force-codex", label: "Force Codex (.agents/) as master source" },
      { value: "force-claude", label: "Force Claude Code (.claude/) as master source" },
      { value: "force-antigravity", label: "Force Antigravity (.antigravity/) as master source" },
    ],
  });

  if (p.isCancel(stratChoice)) {
    throw new Error("CANCELLED");
  }
  return stratChoice as MigrationStrategy;
}

/**
 * Determines the target destination framework (antigravity, claude, codex).
 * 
 * @param options - The CLI options.
 * @param isAgent - Whether an agent is running.
 * @param autoConfirm - Whether auto-confirm is enabled.
 * @returns A promise that resolves to the chosen TargetFramework.
 */
async function determineTarget(
  options: MigrateOptions,
  isAgent: boolean,
  autoConfirm: boolean
): Promise<TargetFramework> {
  if (options.target) {
    return options.target;
  }
  if (autoConfirm || isAgent) {
    return "antigravity";
  }

  const targetChoice = await p.select({
    message: "Select the destination framework to update/write skills into:",
    options: [
      { value: "antigravity", label: "Antigravity 2.0 (.antigravity/)" },
      { value: "claude", label: "Claude Code (.claude/)" },
      { value: "codex", label: "Codex (.agents/)" },
    ],
  });

  if (p.isCancel(targetChoice)) {
    throw new Error("CANCELLED");
  }
  return targetChoice as TargetFramework;
}

/**
 * Evaluates the status of each skill relative to the target destination and strategy.
 * 
 * @param workspaceRoot - The root path of the workspace.
 * @param matrix - The audited skill matrix.
 * @param strategy - The selected migration strategy.
 * @param targetFramework - The selected destination framework.
 * @param selectedTargetDir - The resolved destination path for the target framework's skills.
 * @param lockfile - The loaded lockfile object.
 * @returns An array of SkillStatus objects.
 */
export function evaluateSyncCandidates(
  workspaceRoot: string,
  matrix: SkillRow[],
  strategy: MigrationStrategy,
  targetFramework: TargetFramework,
  selectedTargetDir: string,
  lockfile: Lockfile
): SkillStatus[] {
  const codexSkillsDir = path.join(workspaceRoot, ".agents", "skills");
  const kilocodeSkillsDir = path.join(workspaceRoot, ".kilocode", "skills");
  const antigravitySkillsDir = path.join(workspaceRoot, ".antigravity", "skills");

  const syncCandidates: SkillStatus[] = [];

  for (const row of matrix) {
    let sourcePath: string | undefined;
    let sourceScore: FreshnessScore | undefined;
    let sourceName = "none";

    const claudePathStr = claudePath(workspaceRoot, row.name);
    const codexPathStr = fs.existsSync(path.join(codexSkillsDir, row.name, "SKILL.md"))
      ? path.join(codexSkillsDir, row.name, "SKILL.md")
      : path.join(kilocodeSkillsDir, row.name, "SKILL.md");
    const antigravityPathStr = path.join(antigravitySkillsDir, row.name, "SKILL.md");

    if (strategy === "freshest") {
      const candidates: { path: string; score: FreshnessScore; name: string }[] = [];
      if (targetFramework !== "claude" && row.claudeScore) {
        candidates.push({ path: claudePathStr, score: row.claudeScore, name: "claude" });
      }
      if (targetFramework !== "codex" && row.codexScore) {
        candidates.push({ path: codexPathStr, score: row.codexScore, name: "codex" });
      }
      if (targetFramework !== "antigravity" && row.antigravityScore) {
        candidates.push({ path: antigravityPathStr, score: row.antigravityScore, name: "antigravity" });
      }

      if (candidates.length > 0) {
        let best = candidates[0];
        for (let i = 1; i < candidates.length; i++) {
          if (isMoreUpToDate(best.score, candidates[i].score)) {
            best = candidates[i];
          }
        }
        sourcePath = best.path;
        sourceScore = best.score;
        sourceName = best.name;
      }
    } else if (strategy === "force-codex" && row.codexScore) {
      sourcePath = codexPathStr;
      sourceScore = row.codexScore;
      sourceName = "codex";
    } else if (strategy === "force-claude" && row.claudeScore) {
      sourcePath = claudePathStr;
      sourceScore = row.claudeScore;
      sourceName = "claude";
    } else if (strategy === "force-antigravity" && row.antigravityScore) {
      sourcePath = antigravityPathStr;
      sourceScore = row.antigravityScore;
      sourceName = "antigravity";
    }

    if (!sourcePath || !sourceScore) {
      continue;
    }

    const destPath = path.join(selectedTargetDir, row.name, "SKILL.md");
    const hasTarget = fs.existsSync(destPath);
    const targetScore = evaluateTargetScore(destPath, targetFramework, row);

    let status: SkillStatus["status"] = "NEW";

    if (!hasTarget) {
      status = "NEW";
    } else if (targetScore) {
      const lockEntry = lockfile.skills[row.name];
      const sourceContent = fs.readFileSync(sourcePath, "utf-8");
      const targetContent = fs.readFileSync(destPath, "utf-8");
      const currentSourceHash = computeHash(sourceContent);
      const currentTargetHash = computeHash(targetContent);

      const isSourceChanged = lockEntry ? lockEntry.sourceHash !== currentSourceHash : true;
      const isTargetChanged = lockEntry ? lockEntry.targetHash !== currentTargetHash : false;

      if (!isSourceChanged && !isTargetChanged) {
        status = "UP_TO_DATE";
      } else if (isSourceChanged && !isTargetChanged) {
        status = "OUTDATED";
      } else if (!isSourceChanged && isTargetChanged) {
        status = "LOCAL_MODIFIED";
      } else {
        status = "CONFLICT";
      }
    }

    syncCandidates.push({
      name: row.name,
      targetPath: destPath,
      bestSource: sourceName,
      bestSourcePath: sourcePath,
      bestSourceScore: sourceScore,
      targetScore,
      status,
    });
  }

  return syncCandidates;
}

/**
 * Determines which skills are selected for migration.
 * Handles the `--skills` option filter or falls back to all non-up-to-date skills.
 * 
 * @param options - The migration options.
 * @param syncCandidates - All evaluated sync candidates.
 * @param nonUpToDate - The non-up-to-date sync candidates.
 * @param autoConfirm - Whether auto-confirm is enabled.
 * @param logger - The logger instance.
 * @returns An array of selected skill names.
 */
async function determineSelectedSkills(
  options: MigrateOptions,
  syncCandidates: SkillStatus[],
  nonUpToDate: SkillStatus[],
  autoConfirm: boolean,
  logger: GrepLogger
): Promise<string[]> {
  let selectedSkills: string[] = [];

  if (options.skills) {
    const filterNames = options.skills.split(",").map((s) => s.trim());
    selectedSkills = syncCandidates
      .map((s) => s.name)
      .filter((name) => filterNames.includes(name));

    if (selectedSkills.length === 0) {
      if (autoConfirm) {
        logger.warn(`No matching skills found from selection: ${options.skills}`);
      } else {
        console.log(chalk.yellow(`⚠️  No matching skills found from selection: ${options.skills}`));
      }
      return [];
    }
  } else {
    selectedSkills = nonUpToDate.map((s) => s.name);
  }

  return selectedSkills;
}

/**
 * Handles the dry-run mode by printing the plan and exiting the process.
 * 
 * @param selectedSkills - The names of the selected skills to migrate.
 * @param syncCandidates - All evaluated sync candidates.
 * @param targetFramework - The destination framework.
 * @param autoConfirm - Whether auto-confirm is enabled.
 * @param logger - The logger instance.
 */
function handleDryRun(
  selectedSkills: string[],
  syncCandidates: SkillStatus[],
  targetFramework: TargetFramework,
  autoConfirm: boolean,
  logger: GrepLogger
): void {
  const formatDateLocal = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  if (autoConfirm) {
    logger.info(`[DRY-RUN] Plan to migrate ${selectedSkills.length} skill(s) to ${targetFramework}.`);
  } else {
    console.log(`\n🔍 **[DRY-RUN MODE]** No files will be modified.`);
  }

  let dryRunCount = 0;
  for (const name of selectedSkills) {
    const s = syncCandidates.find((x) => x.name === name)!;
    if (autoConfirm) {
      logger.info(`[DRY-RUN] Would migrate ${name} [${s.status}] from ${s.bestSource} to ${targetFramework}`);
    } else {
      console.log(`- Would migrate **${name}** [${s.status}] from **${s.bestSource}** to **${targetFramework}**`);
    }
    dryRunCount++;
  }

  if (!autoConfirm) {
    console.log(`\n🎉 Dry-run complete. Checked ${dryRunCount} skill(s).`);
  }
  process.exit(0);
}

/**
 * Prompts the user/agent to confirm the migration plan.
 * 
 * @param selectedSkills - The names of the selected skills.
 * @param syncCandidates - All evaluated sync candidates.
 * @param nonUpToDate - The non-up-to-date sync candidates.
 * @param targetFramework - The destination framework.
 * @param isAgent - Whether an agent is running.
 * @param autoConfirm - Whether auto-confirm is enabled.
 * @returns A promise that resolves to the array of confirmed skill names, or null if cancelled.
 */
async function confirmMigration(
  selectedSkills: string[],
  syncCandidates: SkillStatus[],
  nonUpToDate: SkillStatus[],
  targetFramework: TargetFramework,
  isAgent: boolean,
  autoConfirm: boolean
): Promise<string[] | null> {
  const formatDateLocal = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const askQuestionPlain = (query: string): Promise<string> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  };

  if (autoConfirm) {
    return selectedSkills;
  }

  if (isAgent) {
    console.log("\n### 🔄 Planned Migration Action Plan\n");
    const candidatesToDisplay = selectedSkills.map((name) => syncCandidates.find((x) => x.name === name)!);
    for (const s of candidatesToDisplay) {
      console.log(`- **${s.name}** [${s.status}]: will migrate from **${s.bestSource}** (\`${s.bestSourceScore ? formatDateLocal(s.bestSourceScore.gitDate) : "unknown"}\`) to **${targetFramework}**`);
    }
    console.log("");

    const confirmAnswer = await askQuestionPlain(`❓ Confirm migration of these ${selectedSkills.length} selected skill(s) into ${targetFramework}? (y/N): `);
    const confirmed = confirmAnswer.trim().toLowerCase() === "y" || confirmAnswer.trim().toLowerCase() === "yes";
    return confirmed ? selectedSkills : null;
  }

  // Human interactive TUI checkbox selector
  const optionsList = nonUpToDate.map((s) => ({
    value: s.name,
    label: `${s.name} (${s.status})`,
    hint: `Source: ${s.bestSource} (${s.bestSourceScore ? formatDateLocal(s.bestSourceScore.gitDate) : ""})`,
  }));

  const selectResult = await p.multiselect({
    message: `Select skills to write/merge into target framework ${targetFramework}:`,
    options: optionsList,
    required: true,
  });

  if (p.isCancel(selectResult)) {
    return null;
  }

  return selectResult as string[];
}

/**
 * Executes the migration process for each selected skill.
 * Modifies the destination directory and file contents (with conversions or 3-way merges).
 * 
 * @param selectedTargetDir - The destination path of the target framework.
 * @param selectedSkills - The names of the skills to migrate.
 * @param syncCandidates - All evaluated sync candidates.
 * @param targetFramework - The destination framework.
 * @param lockfile - The lockfile structure.
 * @param logger - The logger instance.
 * @param isAgent - Whether an agent is running.
 * @param autoConfirm - Whether auto-confirm is enabled.
 * @returns A promise resolving to syncCount and conflictCount.
 */
async function executeMigration(
  selectedTargetDir: string,
  selectedSkills: string[],
  syncCandidates: SkillStatus[],
  targetFramework: TargetFramework,
  lockfile: Lockfile,
  logger: GrepLogger,
  isAgent: boolean,
  autoConfirm: boolean
): Promise<{ syncCount: number; conflictCount: number }> {
  let syncCount = 0;
  let conflictCount = 0;

  for (const name of selectedSkills) {
    const s = syncCandidates.find((x) => x.name === name)!;
    const destDir = path.join(selectedTargetDir, name);
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.join(destDir, "SKILL.md");

    if (autoConfirm) {
      logger.syncStart(name, s.status, s.bestSource, targetFramework);
    }

    if (s.status === "NEW" || s.status === "OUTDATED") {
      const sourceContent = fs.readFileSync(s.bestSourcePath!, "utf-8");
      const parsedSource = parseSkillFile(s.bestSourcePath!);
      const converted = convertSkill(parsedSource, targetFramework);
      const outputText = stringifySkill(converted);

      fs.writeFileSync(destPath, outputText, "utf-8");

      const sourceDir = path.dirname(s.bestSourcePath!);
      try {
        const files = fs.readdirSync(sourceDir);
        for (const file of files) {
          if (file !== "SKILL.md") {
            fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
          }
        }
      } catch {
        // Ignore copying other files errors
      }

      lockfile.skills[name] = {
        sourcePath: s.bestSourcePath!,
        targetPath: destPath,
        lastMigration: new Date().toISOString(),
        sourceHash: computeHash(sourceContent),
        targetHash: computeHash(outputText),
        userCustomized: false,
      };

      if (autoConfirm) {
        logger.syncSuccess(name, s.status, destPath);
      } else if (isAgent) {
        console.log(`  ✅ [SUCCESS] ${name} [${s.status}] -> ${destPath}`);
      }
      syncCount++;
    } else if (s.status === "CONFLICT" || s.status === "LOCAL_MODIFIED") {
      const lockEntry = lockfile.skills[name];
      const sourceContent = fs.readFileSync(s.bestSourcePath!, "utf-8");
      const localContent = fs.readFileSync(destPath, "utf-8");

      let baseContent = sourceContent;
      if (lockEntry && fs.existsSync(lockEntry.sourcePath)) {
        baseContent = fs.readFileSync(lockEntry.sourcePath, "utf-8");
      }

      const parsedBase = parseSkillContent(baseContent);
      const parsedLocal = parseSkillContent(localContent);
      const parsedRemote = parseSkillContent(sourceContent);

      const { merged, hasConflicts } = mergeSkills3Way(parsedBase, parsedLocal, parsedRemote);
      const converted = convertSkill(merged, targetFramework);
      const outputText = stringifySkill(converted);

      fs.writeFileSync(destPath, outputText, "utf-8");

      lockfile.skills[name] = {
        sourcePath: s.bestSourcePath!,
        targetPath: destPath,
        lastMigration: new Date().toISOString(),
        sourceHash: computeHash(sourceContent),
        targetHash: computeHash(outputText),
        userCustomized: true,
      };

      if (hasConflicts) {
        if (autoConfirm) {
          logger.syncConflict(name, destPath);
        } else if (isAgent) {
          console.log(`  ⚠️  [CONFLICT] ${name} -> ${destPath} (conflict markers added)`);
        }
        conflictCount++;
      } else {
        if (autoConfirm) {
          logger.syncSuccess(name, s.status, destPath);
        } else if (isAgent) {
          console.log(`  ✅ [SUCCESS] ${name} [${s.status}] -> ${destPath}`);
        }
        syncCount++;
      }
    }
  }

  return { syncCount, conflictCount };
}

/**
 * Runs the workspace migration command.
 * Scans, audits, prompts and synchronizes skills across agentic frameworks.
 * 
 * @param projectRoot - The current project root directory.
 * @param options - Options parsed from CLI arguments.
 */
export async function runMigrateCommand(projectRoot: string, options: MigrateOptions = {}): Promise<void> {
  const logger = new GrepLogger(options.logFormat || "plain");
  const isAgent = isAgentRunning();
  const autoConfirm = !!options.yes;

  let selectedRoot = "";
  try {
    selectedRoot = await resolveWorkspacePath(projectRoot, options, isAgent, autoConfirm, logger);
    if (!selectedRoot) {
      return;
    }
  } catch (error) {
    logger.error(`Error resolving workspace path: ${(error as Error).message}`);
    process.exit(1);
  }

  const filteredSkillNames = scanSkills(selectedRoot);

  if (filteredSkillNames.size === 0) {
    if (autoConfirm) {
      logger.warn(`No skills found in workspace: ${selectedRoot}`);
    } else if (isAgent) {
      console.log(`⚠️  No skills found in workspace: ${selectedRoot}`);
    } else {
      p.note(chalk.yellow(`No skills found in workspace:\n${selectedRoot}`));
      const wantTemplates = await p.confirm({
        message: "Would you like to install basic productivity templates?",
      });
      if (wantTemplates) {
        p.outro("Please run command: template install <template_name>");
      }
    }
    return;
  }

  const lockfile = loadLockfile(selectedRoot);
  const matrix = buildAuditMatrix(selectedRoot, filteredSkillNames, logger, autoConfirm);

  displayAuditMatrix(matrix, isAgent, autoConfirm);

  let strategy: MigrationStrategy;
  let targetFramework: TargetFramework;

  try {
    strategy = await determineStrategy(options, isAgent, autoConfirm);
    targetFramework = await determineTarget(options, isAgent, autoConfirm);
  } catch {
    p.outro("Operation cancelled.");
    return;
  }

  if (isAgent && !autoConfirm) {
    console.log(`⚙️  Target Framework: **${targetFramework}** | Strategy: **${strategy}** (use -t/--target and -s/--strategy to change)`);
  }

  const targetDirMap = {
    antigravity: path.join(selectedRoot, ".antigravity", "skills"),
    claude: path.join(selectedRoot, ".claude", "skills"),
    codex: path.join(selectedRoot, ".agents", "skills"),
  };
  const selectedTargetDir = targetDirMap[targetFramework];

  const syncCandidates = evaluateSyncCandidates(
    selectedRoot,
    matrix,
    strategy,
    targetFramework,
    selectedTargetDir,
    lockfile
  );

  const nonUpToDate = syncCandidates.filter((s) => s.status !== "UP_TO_DATE");

  if (nonUpToDate.length === 0) {
    if (autoConfirm) {
      logger.info(`All skills in target ${targetFramework} are already fully synchronized!`);
    } else if (isAgent) {
      console.log(`✨ All skills in target **${targetFramework}** are already fully synchronized!`);
    } else {
      p.outro(chalk.green(`All skills in target ${targetFramework} are already fully synchronized! ✨`));
    }
    return;
  }

  const selectedSkills = await determineSelectedSkills(options, syncCandidates, nonUpToDate, autoConfirm, logger);
  if (selectedSkills.length === 0) {
    return;
  }

  if (options.dryRun) {
    handleDryRun(selectedSkills, syncCandidates, targetFramework, autoConfirm, logger);
    return;
  }

  const confirmedSkills = await confirmMigration(
    selectedSkills,
    syncCandidates,
    nonUpToDate,
    targetFramework,
    isAgent,
    autoConfirm
  );

  if (!confirmedSkills) {
    if (isAgent) {
      console.log("❌ Migration cancelled by user/agent.");
      process.exit(2);
    } else {
      p.outro("Operation cancelled.");
    }
    return;
  }

  const spinner = (autoConfirm || isAgent) ? null : p.spinner();
  if (spinner) {
    spinner.start("Transmuting skills...");
  } else {
    if (!autoConfirm) {
      console.log(`\n⚡ Transmuting ${confirmedSkills.length} skill(s) into ${targetFramework}...`);
    }
  }

  const { syncCount, conflictCount } = await executeMigration(
    selectedTargetDir,
    confirmedSkills,
    syncCandidates,
    targetFramework,
    lockfile,
    logger,
    isAgent,
    autoConfirm
  );

  saveLockfile(selectedRoot, lockfile);

  if (spinner) {
    spinner.stop("Transmutation complete.");
    if (syncCount > 0) {
      p.note(chalk.green(`Successfully processed and converted ${syncCount} skill(s).`));
    }
    if (conflictCount > 0) {
      p.note(
        chalk.red(
          `${conflictCount} skill(s) completed with conflicts.\nSearch for "<<<<<<< LOCAL" markers inside files to resolve manually.`
        )
      );
    }
    p.outro(chalk.bold.green("Workspace migration completed successfully! 🎉"));
  } else {
    if (autoConfirm) {
      logger.syncCompleted({ processed: syncCount + conflictCount, conflicts: conflictCount });
    } else {
      console.log(`\n🎉 Workspace migration completed successfully!`);
      console.log(`- Processed & converted: ${syncCount} skill(s)`);
      if (conflictCount > 0) {
        console.log(`⚠️  ${conflictCount} skill(s) completed with conflicts.`);
        console.log(`   Search for "<<<<<<< LOCAL" markers inside files to resolve manually.`);
      }
    }
  }

  if (conflictCount > 0) {
    process.exit(3);
  } else {
    process.exit(0);
  }
}

/**
 * Helper to compute the absolute path of a Claude skill file.
 * 
 * @param root - The workspace root path.
 * @param name - The name of the skill.
 * @returns The absolute path to the Claude skill's SKILL.md.
 */
function claudePath(root: string, name: string): string {
  return path.join(root, ".claude", "skills", name, "SKILL.md");
}

/**
 * Evaluates the current freshness score of the target framework's skill file if it exists.
 * 
 * @param destPath - The path to the destination skill file.
 * @param targetFramework - The target framework type.
 * @param row - The skill row containing audited scores.
 * @returns The freshness score or undefined if the target doesn't exist.
 */
function evaluateTargetScore(destPath: string, targetFramework: TargetFramework, row: SkillRow): FreshnessScore | undefined {
  if (!fs.existsSync(destPath)) return undefined;
  if (targetFramework === "claude") return row.claudeScore;
  if (targetFramework === "codex") return row.codexScore;
  return row.antigravityScore;
}
