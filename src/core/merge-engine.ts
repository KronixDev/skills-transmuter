import fs from "fs";
import path from "path";
import crypto from "crypto";
import yaml from "yaml";
import { parseSkillContent, ParsedSkill, MarkdownSection, stringifySkill } from "./parser.js";

/**
 * Represents an individual configuration entry in the lockfile.
 * It is used to store digital signatures and synchronization history
 * to detect user modifications outside the normal sync flow.
 */
export interface LockfileEntry {
  /** Path to the original source skill file. */
  sourcePath: string;
  /** Path to the generated target skill. */
  targetPath: string;
  /** ISO timestamp of the last synchronization operation. */
  lastMigration: string;
  /** SHA-256 hash of the source file at the time of synchronization. */
  sourceHash: string;
  /** SHA-256 hash of the target file immediately after synchronization. */
  targetHash: string;
  /** Flag indicating whether the target file has been modified by the user. */
  userCustomized: boolean;
}

/**
 * Represents the overall structure of the `skills-lock.json` file.
 */
export interface Lockfile {
  /** Register of lock entries indexed by skill name keys. */
  skills: Record<string, LockfileEntry>;
}

/**
 * Loads the `skills-lock.json` lockfile from the root of the specified project.
 * If the file does not exist or contains syntax errors, returns an empty structured object.
 * 
 * @param projectRoot - The absolute path to the project root containing the lockfile.
 * @returns The deserialized lockfile or a default initialized object.
 */
export function loadLockfile(projectRoot: string): Lockfile {
  const lockPath = path.join(projectRoot, "skills-lock.json");
  if (fs.existsSync(lockPath)) {
    try {
      return JSON.parse(fs.readFileSync(lockPath, "utf-8")) as Lockfile;
    } catch {
      // Silently ignore parsing errors and return an empty initialized lockfile
    }
  }
  return { skills: {} };
}

/**
 * Saves the `skills-lock.json` lockfile to the project root.
 * 
 * @param projectRoot - The absolute path to the project root.
 * @param lockfile - The Lockfile object to write.
 */
export function saveLockfile(projectRoot: string, lockfile: Lockfile): void {
  const lockPath = path.join(projectRoot, "skills-lock.json");
  fs.writeFileSync(lockPath, JSON.stringify(lockfile, null, 2), "utf-8");
}

/**
 * Computes the SHA-256 hash of a UTF-8 string.
 * Used to accurately track content changes.
 * 
 * @param content - The raw text content.
 * @returns The hex-encoded SHA-256 digest.
 */
export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Performs a 3-way text merge on a Markdown section content.
 * Compares the modified local version and the updated remote version against a common ancestor (base).
 * 
 * Conflict resolution rules:
 * - If local and remote contents are identical, returns the content without conflicts.
 * - If only one side modified the base, that modification is automatically accepted.
 * - If both sides modified the content:
 *   1. If the files have the same number of lines, merges non-conflicting lines line-by-line.
 *   2. If lines differ at the same index or the line counts differ (additions/deletions),
 *      the block is marked with standard Git conflict boundaries.
 * 
 * @param base - The original common content of the section.
 * @param local - The local user-modified content.
 * @param remote - The remote upstream-updated content.
 * @returns An object containing the merged text and a flag indicating if conflicts are present.
 */
export function mergeText3Way(base: string, local: string, remote: string): { merged: string; hasConflicts: boolean } {
  if (local === remote) return { merged: local, hasConflicts: false };
  if (local === base) return { merged: remote, hasConflicts: false };
  if (remote === base) return { merged: local, hasConflicts: false };

  const baseLines = base.split(/\r?\n/);
  const localLines = local.split(/\r?\n/);
  const remoteLines = remote.split(/\r?\n/);

  // Attempt fine line-by-line merge if the line counts are identical
  if (baseLines.length === localLines.length && baseLines.length === remoteLines.length) {
    const mergedLines: string[] = [];
    let hasConflicts = false;

    for (let i = 0; i < baseLines.length; i++) {
      const b = baseLines[i];
      const l = localLines[i];
      const r = remoteLines[i];

      if (l === r) {
        mergedLines.push(l);
      } else if (l === b) {
        mergedLines.push(r);
      } else if (r === b) {
        mergedLines.push(l);
      } else {
        // Line-level conflict
        mergedLines.push([
          "<<<<<<< LOCAL",
          l,
          "=======",
          r,
          ">>>>>>> REMOTE"
        ].join("\n"));
        hasConflicts = true;
      }
    }

    return {
      merged: mergedLines.join("\n"),
      hasConflicts,
    };
  }

  // Fallback to global section conflict if structural changes (additions/deletions) diverge
  return {
    merged: [
      "<<<<<<< LOCAL (Your modified version)",
      local.trim(),
      "=======",
      remote.trim(),
      ">>>>>>> REMOTE (Upstream update)",
    ].join("\n"),
    hasConflicts: true,
  };
}

/**
 * Merges two AST trees of ParsedSkill (Local and Remote) using a common ancestor Base.
 * 
 * 3-Way AST Merge Principle:
 * Unlike plain text merge which can break metadata formatting or scramble Markdown sections,
 * this method operates on a semantic level:
 * 
 * 1. Frontmatter Merge (YAML metadata):
 *    - Header key-value pairs are merged structurally.
 *    - If a key changed on only one branch, the change is integrated.
 *    - If a field is modified concurrently on both branches:
 *      - For the 'version' key, the highest semver (usually upstream) is preferred.
 *      - For other metadata keys, the local value is preserved to protect user customization.
 * 
 * 2. Markdown Sections Merge (Document Structure):
 *    - Markdown sections (defined by headers h1 to h6) are mapped and aligned by title.
 *    - The overall sequence of sections is preserved by aggregating titles from base, remote, and local versions.
 *    - For each section title:
 *      - Present in all three versions: semantic merge using `mergeText3Way`.
 *      - Added only locally or only upstream: cleanly integrated.
 *      - Added concurrently on both sides with different contents: merged with an empty base to isolate conflicts.
 *      - Deleted on one side but modified on the other: the modified content is preserved or re-introduced.
 *      - Deleted on one side and unmodified on the other: the deletion is applied.
 * 
 * @param base - The common reference (ancestor) skill AST.
 * @param local - The local user-customized skill AST.
 * @param remote - The remote upstream skill AST.
 * @returns The merged ParsedSkill AST and a boolean indicating if conflicts exist.
 */
export function mergeSkills3Way(
  base: ParsedSkill,
  local: ParsedSkill,
  remote: ParsedSkill
): { merged: ParsedSkill; hasConflicts: boolean } {
  let hasConflicts = false;

  // 1. Merge frontmatter structurally
  const mergedFrontmatter: Record<string, any> = {};
  const allKeys = new Set([
    ...Object.keys(base.frontmatter || {}),
    ...Object.keys(local.frontmatter || {}),
    ...Object.keys(remote.frontmatter || {}),
  ]);

  for (const key of allKeys) {
    const bVal = base.frontmatter?.[key];
    const lVal = local.frontmatter?.[key];
    const rVal = remote.frontmatter?.[key];

    const hasBase = base.frontmatter && key in base.frontmatter;
    const hasLocal = local.frontmatter && key in local.frontmatter;
    const hasRemote = remote.frontmatter && key in remote.frontmatter;

    if (hasBase && hasLocal && hasRemote) {
      if (lVal === rVal) {
        mergedFrontmatter[key] = lVal;
      } else if (lVal === bVal) {
        mergedFrontmatter[key] = rVal; // Modified only on remote
      } else if (rVal === bVal) {
        mergedFrontmatter[key] = lVal; // Modified only on local
      } else {
        // Conflict on metadata
        if (key === "version") {
          // Strategic choice: prefer remote version updates
          mergedFrontmatter[key] = rVal;
        } else {
          // Conservative choice: preserve local user customization
          mergedFrontmatter[key] = lVal;
        }
      }
    }
    else if (!hasBase && hasLocal && !hasRemote) {
      // Key added locally
      mergedFrontmatter[key] = lVal;
    }
    else if (!hasBase && !hasLocal && hasRemote) {
      // Key added upstream
      mergedFrontmatter[key] = rVal;
    }
    else if (hasBase && !hasLocal && hasRemote) {
      // Deleted locally but exists in base and remote
      // If the value changed upstream compared to the base, keep it; otherwise leave deleted
      if (rVal !== bVal) {
        mergedFrontmatter[key] = rVal;
      }
    }
    else if (hasBase && hasLocal && !hasRemote) {
      // Deleted remote but exists in base and local
      // If the value changed locally compared to the base, keep it; otherwise leave deleted
      if (lVal !== bVal) {
        mergedFrontmatter[key] = lVal;
      }
    }
    else if (!hasBase && hasLocal && hasRemote) {
      // Key added concurrently without a common base
      if (lVal === rVal) {
        mergedFrontmatter[key] = lVal;
      } else {
        // Prefer local value on direct conflict
        mergedFrontmatter[key] = lVal;
      }
    }
  }

  // 2. Merge Markdown Sections
  const mergedSections: MarkdownSection[] = [];
  
  const baseSectionsMap = new Map(base.sections.map((s) => [s.title, s]));
  const localSectionsMap = new Map(local.sections.map((s) => [s.title, s]));
  const remoteSectionsMap = new Map(remote.sections.map((s) => [s.title, s]));

  // Combine unique titles preserving order of appearance
  const allTitles = Array.from(
    new Set([
      ...base.sections.map((s) => s.title),
      ...remote.sections.map((s) => s.title),
      ...local.sections.map((s) => s.title),
    ])
  );

  for (const title of allTitles) {
    const baseSec = baseSectionsMap.get(title);
    const localSec = localSectionsMap.get(title);
    const remoteSec = remoteSectionsMap.get(title);

    // Case 1: Section exists in base, local, and remote
    if (baseSec && localSec && remoteSec) {
      const { merged, hasConflicts: secConflict } = mergeText3Way(
        baseSec.content,
        localSec.content,
        remoteSec.content
      );
      if (secConflict) hasConflicts = true;
      mergedSections.push({
        title,
        level: localSec.level,
        content: merged,
      });
    }
    // Case 2: New section in remote only
    else if (!baseSec && !localSec && remoteSec) {
      mergedSections.push({ ...remoteSec });
    }
    // Case 3: New section in local only
    else if (!baseSec && localSec && !remoteSec) {
      mergedSections.push({ ...localSec });
    }
    // Case 4: New section added concurrently on both sides (same title, no common base)
    else if (!baseSec && localSec && remoteSec) {
      const { merged, hasConflicts: secConflict } = mergeText3Way(
        "",
        localSec.content,
        remoteSec.content
      );
      if (secConflict) hasConflicts = true;
      mergedSections.push({
        title,
        level: localSec.level,
        content: merged,
      });
    }
    // Case 5: Deleted locally but exists in base and remote
    else if (baseSec && !localSec && remoteSec) {
      // If the section was modified upstream compared to the base, keep it to avoid regression
      if (baseSec.content !== remoteSec.content) {
        mergedSections.push({ ...remoteSec });
      }
    }
    // Case 6: Deleted remote but exists in base and local
    else if (baseSec && localSec && !remoteSec) {
      // If the local user modified the section, preserve it
      if (baseSec.content !== localSec.content) {
        mergedSections.push({ ...localSec });
      }
    }
  }

  return {
    merged: {
      frontmatter: mergedFrontmatter,
      frontmatterRaw: yaml.stringify(mergedFrontmatter),
      sections: mergedSections,
      rawBody: "", // Reconstructed during final stringify
    },
    hasConflicts,
  };
}
