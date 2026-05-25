import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { parseSkillContent, stringifySkill } from "../core/parser.js";
import { convertSkill } from "../core/converter.js";
import { computeHash } from "../core/merge-engine.js";
import { getOptimizationGuidelines } from "../core/guidelines.js";

export function runMcpServer() {
  const server = new Server(
    {
      name: "skills-transmuter-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Définir la liste des outils MCP
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "inspect_workspace",
          description: "Scans the workspace for Claude Code, Codex, and Antigravity skills and reports their status.",
          inputSchema: {
            type: "object",
            properties: {
              projectRoot: {
                type: "string",
                description: "Absolute path to the project root directory.",
              },
            },
            required: ["projectRoot"],
          },
        },
        {
          name: "convert_skill",
          description: "Converts a raw Markdown skill file from Claude/Codex format to a selected target framework format.",
          inputSchema: {
            type: "object",
            properties: {
              rawContent: {
                type: "string",
                description: "Raw Markdown content of the skill file.",
              },
              targetFramework: {
                type: "string",
                enum: ["antigravity", "claude", "codex"],
                description: "Target framework to convert to (default: antigravity).",
              },
            },
            required: ["rawContent"],
          },
        },
        {
          name: "install_skill",
          description: "Installs or updates a converted skill in the target framework skills directory.",
          inputSchema: {
            type: "object",
            properties: {
              projectRoot: {
                type: "string",
                description: "Absolute path to the project root directory.",
              },
              skillName: {
                type: "string",
                description: "The unique folder name for the skill (e.g. candidate-sourcing).",
              },
              content: {
                type: "string",
                description: "The complete markdown content of the skill.",
              },
            },
            required: ["projectRoot", "skillName", "content"],
          },
        },
        {
          name: "get_optimized_guidelines",
          description: "Returns the official optimization guidelines and best practices for creating skills for a target framework.",
          inputSchema: {
            type: "object",
            properties: {
              targetFramework: {
                type: "string",
                enum: ["antigravity", "claude", "codex"],
                description: "Target framework framework (default: antigravity).",
              },
            },
          },
        },
      ],
    };
  });

  // Gérer les appels d'outils
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "inspect_workspace") {
        const root = (args as any).projectRoot;
        if (!root || typeof root !== "string") {
          throw new Error("Missing or invalid argument 'projectRoot'. Must be a non-empty string.");
        }
        const absoluteRoot = path.resolve(root);
        if (!fs.existsSync(absoluteRoot)) {
          throw new Error(`Project root directory does not exist: ${absoluteRoot}`);
        }
        if (!fs.statSync(absoluteRoot).isDirectory()) {
          throw new Error(`Project root is not a directory: ${absoluteRoot}`);
        }

        const claudeDir = path.join(absoluteRoot, ".claude", "skills");
        const codexDir = path.join(absoluteRoot, ".agents", "skills");
        const antiDir = path.join(absoluteRoot, ".antigravity", "skills");

        const skills = new Set<string>();
        const scan = (d: string) => {
          if (fs.existsSync(d)) {
            try {
              fs.readdirSync(d).forEach((i) => {
                try {
                  if (fs.statSync(path.join(d, i)).isDirectory()) skills.add(i);
                } catch {
                  // Ignore inaccessible directories
                }
              });
            } catch {
              // Ignore directory read errors
            }
          }
        };
        scan(claudeDir);
        scan(codexDir);
        scan(antiDir);

        const list = Array.from(skills)
          .map((s) => ({
            name: s,
            hasClaude: fs.existsSync(path.join(claudeDir, s, "SKILL.md")),
            hasCodex: fs.existsSync(path.join(codexDir, s, "SKILL.md")),
            hasAntigravity: fs.existsSync(path.join(antiDir, s, "SKILL.md")),
          }))
          .filter((item) => item.hasClaude || item.hasCodex || item.hasAntigravity);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ skills: list }, null, 2),
            },
          ],
        };
      }

      if (name === "convert_skill") {
        const raw = (args as any).rawContent;
        if (!raw || typeof raw !== "string") {
          throw new Error("Missing or invalid argument 'rawContent'. Must be a non-empty string.");
        }
        const target = (args as any).targetFramework || "antigravity";
        if (!["antigravity", "claude", "codex"].includes(target)) {
          throw new Error(`Invalid 'targetFramework': "${target}". Expected one of: antigravity, claude, codex.`);
        }

        const parsed = parseSkillContent(raw);
        const converted = convertSkill(parsed, target);
        const result = stringifySkill(converted);

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }

      if (name === "install_skill") {
        const root = (args as any).projectRoot;
        if (!root || typeof root !== "string") {
          throw new Error("Missing or invalid argument 'projectRoot'. Must be a non-empty string.");
        }
        const absoluteRoot = path.resolve(root);
        if (!fs.existsSync(absoluteRoot)) {
          throw new Error(`Project root directory does not exist: ${absoluteRoot}`);
        }
        if (!fs.statSync(absoluteRoot).isDirectory()) {
          throw new Error(`Project root is not a directory: ${absoluteRoot}`);
        }

        const sName = (args as any).skillName;
        if (!sName || typeof sName !== "string") {
          throw new Error("Missing or invalid argument 'skillName'. Must be a non-empty string.");
        }

        // Prevent Path Traversal
        const normalizedSkillName = path.normalize(sName);
        if (
          normalizedSkillName.includes("..") ||
          normalizedSkillName.includes("/") ||
          normalizedSkillName.includes("\\") ||
          normalizedSkillName === "." ||
          normalizedSkillName === ""
        ) {
          throw new Error(`Invalid 'skillName': "${sName}". It must be a simple folder name and cannot contain path traversal characters.`);
        }

        const content = (args as any).content;
        if (!content || typeof content !== "string") {
          throw new Error("Missing or invalid argument 'content'. Must be a non-empty string.");
        }

        const destDir = path.join(absoluteRoot, ".antigravity", "skills", normalizedSkillName);
        fs.mkdirSync(destDir, { recursive: true });

        const destPath = path.join(destDir, "SKILL.md");
        fs.writeFileSync(destPath, content, "utf-8");

        return {
          content: [
            {
              type: "text",
              text: `Successfully installed skill '${normalizedSkillName}' at ${destPath}`,
            },
          ],
        };
      }

      if (name === "get_optimized_guidelines") {
        const target = (args as any).targetFramework || "antigravity";
        if (!["antigravity", "claude", "codex"].includes(target)) {
          throw new Error(`Invalid 'targetFramework': "${target}". Expected one of: antigravity, claude, codex.`);
        }

        const result = getOptimizationGuidelines(target);

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }

      throw new Error(`Tool ${name} not found`);
    } catch (e: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: e.message || String(e),
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("Skills Transmuter MCP Server running on stdio");
  });
}
