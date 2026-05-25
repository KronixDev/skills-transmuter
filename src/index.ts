import { runMigrateCommand, MigrateOptions } from "./commands/migrate.js";
import { runMcpServer } from "./mcp/server.js";
import { getOptimizationGuidelines } from "./core/guidelines.js";
import { isAgentRunning } from "./core/agent-detector.js";
import { printThemeBanner } from "./core/theme.js";
import * as p from "@clack/prompts";
import chalk from "chalk";
import path from "path";
import fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  const options: MigrateOptions = {};
  let showHelp = false;
  let command = "";

  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (arg === "--dir" || arg === "-d") {
        options.dir = args[++i];
      } else if (arg.startsWith("--dir=")) {
        options.dir = arg.substring(6);
      } else if (arg === "--preset" || arg === "-p") {
        options.preset = args[++i];
      } else if (arg.startsWith("--preset=")) {
        options.preset = arg.substring(9);
      } else if (arg === "--target" || arg === "-t") {
        options.target = args[++i] as any;
      } else if (arg.startsWith("--target=")) {
        options.target = arg.substring(9) as any;
      } else if (arg === "--strategy" || arg === "-s") {
        options.strategy = args[++i] as any;
      } else if (arg.startsWith("--strategy=")) {
        options.strategy = arg.substring(11) as any;
      } else if (arg === "--yes" || arg === "-y") {
        options.yes = true;
      } else if (arg === "--log" || arg === "-l") {
        options.logFormat = args[++i] as any;
      } else if (arg.startsWith("--log=")) {
        options.logFormat = arg.substring(6) as any;
      } else if (arg === "--dry-run") {
        options.dryRun = true;
      } else if (arg === "--skills") {
        options.skills = args[++i];
      } else if (arg.startsWith("--skills=")) {
        options.skills = arg.substring(9);
      } else if (arg === "--help" || arg === "-h") {
        showHelp = true;
      }
    } else {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length > 0) {
    command = positionalArgs[0];
  } else {
    // If command was omitted but flags are provided, default to migrate
    command = "migrate";
  }

  if (showHelp) {
    console.log(
      [
        chalk.bold.cyan("🔄 Skills Transmuter & Sync Engine - Help"),
        "",
        chalk.bold("Usage:"),
        "  skills-transmuter [command] [options]",
        "",
        chalk.bold("Commands:"),
        `  ${chalk.bold("migrate")}                     Starts the migration wizard (default).`,
        `  ${chalk.bold("mcp")}                         Starts the background stdio MCP server.`,
        `  ${chalk.bold("guidelines")}                   Prints framework best practices guidelines (use with -t/--target).`,
        `  ${chalk.bold("template list")}               Lists standard productivity templates.`,
        `  ${chalk.bold("template install <name>")}     Scaffolds a basic productivity template.`,
        "",
        chalk.bold("Options for 'migrate':"),
        `  ${chalk.bold("-d, --dir <path>")}            Target workspace path.`,
        `  ${chalk.bold("-p, --preset <name>")}          Quick scan preset (${chalk.dim("DevLab")}, ${chalk.dim("Documents")}).`,
        `  ${chalk.bold("-t, --target <framework>")}     Target framework: ${chalk.dim("antigravity")}, ${chalk.dim("claude")}, ${chalk.dim("codex")}.`,
        `  ${chalk.bold("-s, --strategy <policy>")}      Migration strategy: ${chalk.dim("freshest")}, ${chalk.dim("force-codex")}, ${chalk.dim("force-claude")}, ${chalk.dim("force-antigravity")}.`,
        `  ${chalk.bold("-y, --yes")}                    Silent execution. Skips TUI prompts and confirmations.`,
        `  ${chalk.bold("-l, --log <format>")}           Logging format: ${chalk.dim("plain")} (default) or ${chalk.dim("json")}.`,
        `  ${chalk.bold("--dry-run")}                    Preview migration actions without writing files.`,
        `  ${chalk.bold("--skills <list>")}              Comma-separated names of specific skills to migrate.`,
        `  ${chalk.bold("-h, --help")}                   Displays this help menu.`,
        "",
        chalk.bold("Examples:"),
        "  skills-transmuter migrate -d ./my-project -t antigravity -s freshest -y",
        "  skills-transmuter migrate -p DevLab -d Draft/next-app -t antigravity -y",
        "  skills-transmuter migrate -d ./my-project -l json",
        "",
      ].join("\n")
    );
    return;
  }

  const projectRoot = process.cwd();
  const isAgent = isAgentRunning();

  // Print banner for interactive subcommands (e.g. templates, help) only when run by a human
  if (!isAgent && command !== "migrate" && command !== "mcp" && command !== "guidelines") {
    printThemeBanner();
  }

  if (command === "mcp") {
    runMcpServer();
    return;
  }

  if (command === "guidelines") {
    const target = options.target || "antigravity";
    console.log(getOptimizationGuidelines(target));
    return;
  }

  if (command === "migrate") {
    await runMigrateCommand(projectRoot, options);
    return;
  }

  if (command === "template") {
    const subCommand = args[1];
    if (subCommand === "list") {
      p.intro(chalk.bold.cyan("📚 Available Productivity Templates"));
      p.note(
        [
          `1. ${chalk.bold("scqa-framework")} : Logical structuring for documents.`,
          `2. ${chalk.bold("content-repurposing")} : Recycles blogs into newsletter/tweets.`,
          `3. ${chalk.bold("excalidraw-builder")} : Generates JSON visual diagrams.`,
          `4. ${chalk.bold("deep-research")} : Recursive web research and synthesis.`,
          `5. ${chalk.bold("code-auditor")} : Security and bug audits.`,
          `6. ${chalk.bold("workflow-automation")} : Automating complex repetitive tasks.`,
        ].join("\n"),
        "Use 'template install <name>' to install a template."
      );
      p.outro("End of template list.");
      return;
    }

    if (subCommand === "install") {
      const templateName = args[2];
      if (!templateName) {
        p.note(chalk.red("Error: Please specify the template name (e.g. template install scqa-framework)."));
        return;
      }

      const destDir = path.join(projectRoot, ".antigravity", "skills", templateName);
      fs.mkdirSync(destDir, { recursive: true });

      const defaultSkill = [
        "---",
        `name: ${templateName}`,
        `description: Productivity template ${templateName} for Antigravity 2.0`,
        "version: 1.0.0",
        "framework: antigravity",
        "model: gemini-3.5-flash",
        "---",
        "",
        `# Skill ${templateName}`,
        "",
        "## Instructions",
        "- Strictly follow operational guidelines.",
        "- Utilize designated tools.",
      ].join("\n");

      fs.writeFileSync(path.join(destDir, "SKILL.md"), defaultSkill, "utf-8");
      p.note(chalk.green(`Template '${templateName}' successfully installed at ${destDir}/SKILL.md.`));
      return;
    }

    p.note(chalk.yellow("Unknown template subcommand. Try: template list / template install <name>"));
    return;
  }

  // If unknown command
  p.note(
    [
      `Available Commands:`,
      `  - ${chalk.bold("migrate")} : Starts the interactive migration wizard.`,
      `  - ${chalk.bold("mcp")} : Starts the background stdio MCP server.`,
      `  - ${chalk.bold("template list")} : Lists standard productivity templates.`,
      `  - ${chalk.bold("template install <name>")} : Scaffolds a basic productivity template.`,
    ].join("\n"),
    "Help - Skills Transmuter"
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
