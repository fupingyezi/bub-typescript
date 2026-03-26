import chalk from "chalk";
import figlet from "figlet";

export class CliRenderer {
  constructor() {}

  welcome(options: { model: string; workspace: string }): void {
    console.log(chalk.cyan(figlet.textSync("Bub", { font: "Small" })));
    console.log(chalk.gray(`Model: ${options.model}`));
    console.log(chalk.gray(`Workspace: ${options.workspace}`));
    console.log();
  }

  error(content: string): void {
    console.log(chalk.red(`Error: ${content}`));
  }

  commandOutput(content: string): void {
    console.log(chalk.yellow(content));
  }

  assistantOutput(content: string): void {
    console.log(chalk.green(content));
  }

  info(content: string): void {
    console.log(chalk.blue(content));
  }
}
