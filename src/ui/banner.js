/**
 * Banner / branding for WebClaw CLI
 */

export function banner() {
  const orange = "\x1b[38;5;214m";
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  return `
${orange}╦ ╦${cyan}┌─┐┌┐ ${orange}╔═╗${cyan}┬  ┌─┐┬ ┬${reset}
${orange}║║║${cyan}├┤ ├┴┐${orange}║  ${cyan}│  ├─┤│││${reset}
${orange}╚╩╝${cyan}└─┘└─┘${orange}╚═╝${cyan}┴─┘┴ ┴└┴┘${reset}
${dim}Zero-cost AI CLI Agent v1.0.0${reset}
${dim}Qwen International + DeepSeek (Chrome Automation)${reset}
`;
}

export function success(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

export function error(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}

export function info(msg) {
  console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
}

export function warn(msg) {
  console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
}

export function dim(msg) {
  console.log(`\x1b[2m${msg}\x1b[0m`);
}
