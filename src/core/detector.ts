import fs from "fs";
import { execSync } from "child_process";
import { parseSkillFile, ParsedSkill } from "./parser.js";

export interface FreshnessScore {
  filePath: string;
  semver: string; // e.g., "1.0.0"
  gitDate: Date;
  sri: number; // Semantic Richness Index (complexity/length of lists)
  modernity: number; // API alignment index (subagents, multimodal tools)
  compositeScore: number; // Overall calculated score
}

/**
 * Lit la date du dernier commit Git d'un fichier, ou à défaut sa date de modification système.
 */
export function getFileModificationDate(filePath: string): Date {
  try {
    const output = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output) {
      return new Date(output);
    }
  } catch (error) {
    // Ignore error and fallback to filesystem
  }
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime;
  } catch {
    return new Date(0); // Epoch fallback
  }
}

/**
 * Calcule l'indice de richesse sémantique (SRI) basé sur l'AST ou le contenu.
 * Compte le nombre d'instructions (lignes commençant par - ou * ou nombre total de caractères).
 */
export function calculateSemanticRichness(parsed: ParsedSkill): number {
  let listItemsCount = 0;
  let wordCount = 0;

  for (const section of parsed.sections) {
    const lines = section.content.split("\n");
    for (const line of lines) {
      if (/^\s*[-*+]\s+/.test(line)) {
        listItemsCount++;
      }
      wordCount += line.split(/\s+/).filter(Boolean).length;
    }
  }

  // SRI = (Nombre d'éléments de liste * 10) + (Nombre de mots / 5)
  return listItemsCount * 10 + Math.round(wordCount / 5);
}

/**
 * Calcule l'indice d'alignement API (Modernity).
 * Donne des bonus pour l'utilisation d'API modernes d'Antigravity 2.0 / Gemini 3.5 (view_file, invoke_subagent, schedule)
 * et pénalise les anciennes directives ou scripts d'OCR manuels complexes.
 */
export function calculateApiModernity(parsed: ParsedSkill): number {
  let score = 50; // Score de base
  const contentLower = JSON.stringify(parsed).toLowerCase();

  // Modern Antigravity tools
  if (contentLower.includes("view_file")) score += 15;
  if (contentLower.includes("invoke_subagent")) score += 15;
  if (contentLower.includes("schedule")) score += 10;
  if (contentLower.includes("gemini-3.5-flash") || contentLower.includes("gemini-3.1-pro")) score += 15;

  // Legacy/obsolete tools to penalize
  if (contentLower.includes("spawn_agent")) score -= 10;
  if (contentLower.includes("ocr") || contentLower.includes("tesseract")) score -= 5; // Haiku/OCR scripts instead of native view_file

  return Math.max(0, score);
}

/**
 * Évalue le score de fraîcheur global d'un fichier de skill.
 */
export function evaluateFreshness(filePath: string): FreshnessScore {
  const parsed = parseSkillFile(filePath);
  const semver = parsed.frontmatter.version || parsed.frontmatter.semver || "0.0.0";
  const gitDate = getFileModificationDate(filePath);
  const sri = calculateSemanticRichness(parsed);
  const modernity = calculateApiModernity(parsed);

  // Score composite :
  // Convertit SemVer en valeur numérique approximative (ex: 1.2.3 -> 10203)
  const semverParts = String(semver).split(".").map((p) => parseInt(p, 10) || 0);
  const semverVal = (semverParts[0] || 0) * 10000 + (semverParts[1] || 0) * 100 + (semverParts[2] || 0);

  // Age en jours par rapport au 1er Janvier 2026 (référence fixe)
  const refDate = new Date("2026-01-01T00:00:00Z").getTime();
  const fileAgeDays = Math.round((gitDate.getTime() - refDate) / (1000 * 60 * 60 * 24));

  // Score composite = (SemVer * 10) + (Age en jours) + (SRI / 5) + Modernity
  const compositeScore = semverVal * 10 + fileAgeDays + Math.round(sri / 5) + modernity;

  return {
    filePath,
    semver,
    gitDate,
    sri,
    modernity,
    compositeScore,
  };
}

/**
 * Compare deux versions d'un même skill pour déterminer si le fichier B est plus à jour que le fichier A.
 * Retourne true si B est plus récent/pertinent.
 */
export function isMoreUpToDate(scoreA: FreshnessScore, scoreB: FreshnessScore): boolean {
  // 1. D'abord comparer SemVer si disponible et différent
  if (scoreA.semver !== "0.0.0" && scoreB.semver !== "0.0.0" && scoreA.semver !== scoreB.semver) {
    const partsA = scoreA.semver.split(".").map(Number);
    const partsB = scoreB.semver.split(".").map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const valA = partsA[i] || 0;
      const valB = partsB[i] || 0;
      if (valB > valA) return true;
      if (valA > valB) return false;
    }
  }

  // 2. Si SemVer est le même ou non défini, utiliser le score composite global
  return scoreB.compositeScore > scoreA.compositeScore;
}
