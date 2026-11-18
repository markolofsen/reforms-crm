#!/usr/bin/env node
// The terminal's fake shell (P49 T1, `HUB_TERMINAL_SHELL=fake`): a prompt and a few commands, so tests and e2e drive a
// real PTY without the owner's shell. Each line is echoed as `> <line>`; `size` then prints the PTY's columns and rows, `pwd` the folder; `exit N` exits with N.
import process from "node:process";

const out = (s) => process.stdout.write(s);
const prompt = () => out("fake$ ");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let line = "";
out("fake shell ready\r\n");
prompt();
process.stdin.on("data", (buf) => {
  for (const ch of buf.toString("utf8")) {
    if (ch === "\x1b") { out("[esc]\r\n"); prompt(); continue; }
    if (ch === "\r" || ch === "\n") {
      out("\r\n");
      run(line.trim());
      line = "";
      continue;
    }
    if (ch === "\x7f") { if (line) { line = line.slice(0, -1); out("\b \b"); } continue; }
    line += ch;
    out(ch);
  }
});

function run(cmd) {
  if (cmd === "") return prompt();
  const exit = /^exit(?:\s+(\d+))?$/.exec(cmd);
  if (exit) process.exit(Number(exit[1] ?? 0));
  out(`> ${cmd}\r\n`); // every line is echoed first, so a test waits for the echo and then reads the answer
  if (cmd === "size") out(`${process.stdout.columns} ${process.stdout.rows}\r\n`);
  else if (cmd === "pwd") out(`${process.cwd()}\r\n`);
  else if (cmd === "color") out("\x1b[38;2;255;100;0mtruecolor\x1b[0m\r\n");
  prompt();
}
