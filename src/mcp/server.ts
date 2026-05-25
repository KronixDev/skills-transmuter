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
        const claudeDir = path.join(root, ".claude", "skills");
        const codexDir = path.join(root, ".agents", "skills");
        const antiDir = path.join(root, ".antigravity", "skills");

        const skills = new Set<string>();
        const scan = (d: string) => {
          if (fs.existsSync(d)) {
            fs.readdirSync(d).forEach((i) => {
              if (fs.statSync(path.join(d, i)).isDirectory()) skills.add(i);
            });
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
        const target = (args as any).targetFramework || "antigravity";
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
        const sName = (args as any).skillName;
        const content = (args as any).content;

        const destDir = path.join(root, ".antigravity", "skills", sName);
        fs.mkdirSync(destDir, { recursive: true });

        const destPath = path.join(destDir, "SKILL.md");
        fs.writeFileSync(destPath, content, "utf-8");

        return {
          content: [
            {
              type: "text",
              text: `Successfully installed skill '${sName}' at ${destPath}`,
            },
          ],
        };
      }

      if (name === "get_optimized_guidelines") {
        const target = (args as any).targetFramework || "antigravity";
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
