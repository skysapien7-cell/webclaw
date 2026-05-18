/**
 * Live multi-line status display for parallel sub-agents.
 *
 * Shows one animated line per agent, updates in-place using ANSI cursor movement.
 * Agents show a spinner while working; a ✓ and summary when done.
 * Does NOT show the agent's response text — just "alive" heartbeat + result.
 *
 * Usage:
 *   const display = new AgentStatusDisplay(agents);
 *   display.start();
 *   display.setStatus(agentId, "searching docs...");
 *   display.setDone(agentId, "found 3 bottlenecks — confidence 8/10");
 *   display.stop();
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function shortRole(role) {
  return role.split("—")[0].trim().split(" ").slice(0, 2).join(" ");
}

export class AgentStatusDisplay {
  constructor(agents) {
    this.agents = agents; // [{ id, role }]
    this.statuses = agents.map(() => "starting...");
    this.frames = agents.map(() => 0);
    this.done = agents.map(() => false);
    this.timer = null;
    this._rendered = false;
  }

  /** Print initial lines and start the animation loop. */
  start() {
    process.stdout.write("\n");
    for (let i = 0; i < this.agents.length; i++) {
      process.stdout.write(
        `  ${FRAMES[0]} \x1b[36mAgent ${this.agents[i].id + 1}\x1b[0m ` +
        `\x1b[2m[${shortRole(this.agents[i].role)}]\x1b[0m: starting...\n`
      );
    }
    this._rendered = true;
    this.timer = setInterval(() => this._tick(), 100);
  }

  _tick() {
    // Move cursor up to first agent line
    process.stdout.write(`\x1b[${this.agents.length}A`);

    for (let i = 0; i < this.agents.length; i++) {
      const isDone = this.done[i];
      const icon = isDone ? "\x1b[32m✓\x1b[0m" : `\x1b[33m${FRAMES[this.frames[i] % FRAMES.length]}\x1b[0m`;
      const status = isDone
        ? `\x1b[32m${this.statuses[i]}\x1b[0m`
        : `\x1b[2m${this.statuses[i]}\x1b[0m`;

      if (!isDone) this.frames[i]++;

      process.stdout.write(
        `\r\x1b[K  ${icon} \x1b[36mAgent ${this.agents[i].id + 1}\x1b[0m ` +
        `\x1b[2m[${shortRole(this.agents[i].role)}]\x1b[0m: ${status}\n`
      );
    }
  }

  /** Update a running agent's status text (shown as dim while working). */
  setStatus(agentId, status) {
    const idx = this.agents.findIndex((a) => a.id === agentId);
    if (idx !== -1) this.statuses[idx] = status;
  }

  /** Mark an agent as done with its final summary. */
  setDone(agentId, summary) {
    const idx = this.agents.findIndex((a) => a.id === agentId);
    if (idx !== -1) {
      this.done[idx] = true;
      this.statuses[idx] = summary;
    }
  }

  /** Stop the animation and do one final render. */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._rendered) this._tick();
    process.stdout.write("\n");
  }
}
