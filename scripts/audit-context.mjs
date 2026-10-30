#!/usr/bin/env node
// Context audit. Keeps the instruction tree from rotting the way CLAUDE.md did:
// AGENTS.md growing back into a design document, a doc getting deleted while
// something still points at it, or a skill whose frontmatter no agent will load.
//
// Runs first in `npm run check`, so drift fails the same gate as broken code.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (path) => readFileSync(join(root, path), "utf8");

// The root file loads on every turn, so growth is a behavioural cost, not a
// style one. Raise these only with evidence that the content is carrying its
// weight; the previous 58 KB version measurably diluted adherence.
const AGENTS_LINE_BUDGET = 140;
const AGENTS_CHAR_BUDGET = 14_000;

const agents = read("AGENTS.md");
const agentLines = agents.replace(/\n$/, "").split("\n").length;
if (agentLines > AGENTS_LINE_BUDGET) {
  fail(`AGENTS.md: ${agentLines} lines, budget ${AGENTS_LINE_BUDGET}`);
}
if (agents.length > AGENTS_CHAR_BUDGET) {
  fail(`AGENTS.md: ${agents.length} chars, budget ${AGENTS_CHAR_BUDGET}`);
}
if (!/^Canary:/m.test(agents)) {
  fail("AGENTS.md: canary line missing, so a silent load failure is invisible");
}

// Every referenced .md must resolve. A bare filename means "sibling in
// docs/architecture", which is how those docs refer to each other.
const docsDir = "docs/architecture";
const docs = existsSync(join(root, docsDir))
  ? readdirSync(join(root, docsDir)).filter((f) => f.endsWith(".md"))
  : [];
const rootDocs = readdirSync(root).filter((f) => f.endsWith(".md"));
const skillsRoot = join(root, ".agents/skills");
const skillNames = existsSync(skillsRoot)
  ? readdirSync(skillsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  : [];

const sources = [
  "AGENTS.md",
  ...docs.map((f) => `${docsDir}/${f}`),
  ...skillNames.map((n) => `.agents/skills/${n}/SKILL.md`),
];

for (const file of sources) {
  if (!existsSync(join(root, file))) continue;
  for (const [, ref] of read(file).matchAll(/`([A-Za-z0-9._/-]+\.md)`/g)) {
    if (ref === "SKILL.md") continue;
    const resolves = ref.includes("/")
      ? existsSync(join(root, ref))
      : docs.includes(ref) || rootDocs.includes(ref);
    if (!resolves) fail(`${file}: broken reference \`${ref}\``);
  }
}

// Skill frontmatter. Zed rejects rather than warns on a bad name or a missing
// description, and only discovers direct children of the skills root.
for (const name of skillNames) {
  const file = `.agents/skills/${name}/SKILL.md`;
  if (!existsSync(join(root, file))) {
    fail(`${file}: missing (a skill folder needs a SKILL.md)`);
    continue;
  }
  const frontmatter = read(file).match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    fail(`${file}: no frontmatter`);
    continue;
  }

  const fields = {};
  for (const line of frontmatter[1].split("\n")) {
    const pair = line.match(/^([a-z-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }

  const declared = fields.name ?? "";
  const description = fields.description ?? "";
  if (declared !== name) {
    fail(`${file}: name "${declared}" does not match its folder "${name}"`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(declared) || declared.length > 64) {
    fail(`${file}: name "${declared}" is not [a-z0-9-]+`);
  }
  if (!description) {
    fail(`${file}: description missing, so no agent can decide when to load it`);
  } else if (description.length > 1024) {
    fail(`${file}: description is ${description.length} chars, max 1024`);
  }

  const nested = readdirSync(join(skillsRoot, name), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsRoot, name, e.name, "SKILL.md")))
    .map((e) => e.name);
  for (const sub of nested) {
    fail(`${file}: nested skill at ${sub}/SKILL.md is never discovered`);
  }
}

if (failures.length > 0) {
  console.error(`\ncontext audit failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `context audit ok: AGENTS.md ${agentLines} lines, ${docs.length} docs, ${skillNames.length} skills`,
);
