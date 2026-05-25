import chalk from "chalk";

const SKILLS_ASCII = [
  "  ____  _  _____ _     _     ____  ",
  " / ___|| |/ /_ _| |   | |   / ___| ",
  " \\___ \\| ' / | || |   | |   \\___ \\ ",
  "  ___) | . \\ | || |___| |___ ___) |",
  " |____/|_|\\_\\___|_____|_____|____/ "
];

const TRANSMUTER_ASCII = [
  "  _____ ____   _   _   _ ____  __  __ _   _ _____ _____ ____  ",
  " |_   _|  _ \\ / \\ | \\ | / ___||  \\/  | | | |_   _| ____|  _ \\ ",
  "   | | | |_) / _ \\|  \\| \\___ \\| |\\/| | | | | | | |  _| | |_) |",
  "   | | |  _ / ___ \\ |\\  |___) | |  | | |_| | | | | |___|  _ < ",
  "   |_| |_| /_/   \\_\\_| \\_|____/|_|  |_|\\___/  |_| |_____|_| \\_\\"
];

export const Theme = {
  // Brand colors
  primary: (text: string) => chalk.cyan(text),
  accent: (text: string) => chalk.magenta(text),
  success: (text: string) => chalk.green(text),
  warning: (text: string) => chalk.yellow(text),
  error: (text: string) => chalk.red(text),
  muted: (text: string) => chalk.gray(text),
  bold: (text: string) => chalk.bold(text),
  
  // UI Borders
  border: (text: string) => chalk.dim.cyan(text),
  
  // Status Labels (padded to exactly 9 characters for alignment)
  statusNew: () => chalk.bold.green("  [NEW]  "),
  statusUpToDate: () => chalk.dim.gray(" [SYNC]  "),
  statusOutdated: () => chalk.bold.yellow(" [STALE] "),
  statusLocalModified: () => chalk.bold.magenta(" [MODIF] "),
  statusConflict: () => chalk.bold.red(" [MERGE] "),
  statusMissing: () => chalk.dim.red(" [MISS]  "),

  // Version formatter
  version: (semver: string) => chalk.green(` v${semver} `),
};

export function printThemeBanner() {
  const logoWidth = 62;
  const interiorWidth = logoWidth + 2; // 64 interior space (including padding spaces)
  
  // Top border with integrated title
  const title = "── Skills Transmuter v2.0.0 ";
  const remainingDashes = interiorWidth - title.length;
  const topBorder = Theme.border("  ┌" + title + "─".repeat(remainingDashes) + "┐");
  
  const bottomBorder = Theme.border("  └" + "─".repeat(interiorWidth) + "┘");
  const middleSpacing = Theme.border("  │ " + " ".repeat(logoWidth) + " │");
  
  console.log("");
  console.log(topBorder);
  console.log(middleSpacing);
  
  // Print SKILLS
  for (const line of SKILLS_ASCII) {
    const paddedLine = line.padEnd(logoWidth, " ");
    console.log(Theme.border("  │ ") + Theme.primary(paddedLine) + Theme.border(" │"));
  }
  
  console.log(middleSpacing);
  
  // Print TRANSMUTER
  for (const line of TRANSMUTER_ASCII) {
    const paddedLine = line.padEnd(logoWidth, " ");
    console.log(Theme.border("  │ ") + Theme.accent(paddedLine) + Theme.border(" │"));
  }
  
  console.log(middleSpacing);
  
  // Subtext
  const subtext = "Alchemical Engine for Agent Skill Conversion";
  const paddingLength = (logoWidth - subtext.length) / 2;
  const leftPad = " ".repeat(Math.floor(paddingLength));
  const rightPad = " ".repeat(Math.ceil(paddingLength));
  console.log(
    Theme.border("  │ ") + 
    leftPad + 
    chalk.italic.cyan(subtext) + 
    rightPad + 
    Theme.border(" │")
  );
  
  console.log(middleSpacing);
  console.log(bottomBorder);
  console.log("");
}
