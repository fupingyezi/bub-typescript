import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface SkillMetadata {
  name: string;
  description: string;
  location: string;
  source: "project" | "global" | "builtin";
  metadata: Record<string, any>;
}

export const PROJECT_SKILLS_DIR = ".agents/skills";
export const LEGACY_SKILLS_DIR = ".agent/skills";
export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SKILL_SOURCES: Array<"project" | "global" | "builtin"> = [
  "project",
  "global",
  "builtin",
];

function parseFrontmatter(content: string): Record<string, any> {
  const lines = content.split("\n");
  if (!lines || lines[0].trim() !== "---") {
    return {};
  }

  for (let idx = 1; idx < lines.length; idx++) {
    if (lines[idx].trim() === "---") {
      const payload = lines.slice(1, idx).join("\n");
      try {
        const parsed = yaml.load(payload);
        if (typeof parsed === "object" && parsed !== null) {
          return Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => [
              String(key).toLowerCase(),
              value,
            ]),
          );
        }
      } catch {
        return {};
      }
      break;
    }
  }
  return {};
}

function isValidFrontmatter(
  skillDir: string,
  metadata: Record<string, any>,
): boolean {
  const name = metadata.name;
  const description = metadata.description;
  return (
    isValidName(name, skillDir) &&
    isValidDescription(description) &&
    isValidMetadataField(metadata.metadata)
  );
}

function isValidName(name: unknown, skillDir: string): boolean {
  if (typeof name !== "string") {
    return false;
  }
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 64) {
    return false;
  }
  if (normalizedName !== path.basename(skillDir)) {
    return false;
  }
  return SKILL_NAME_PATTERN.test(normalizedName);
}

function isValidDescription(description: unknown): boolean {
  if (typeof description !== "string") {
    return false;
  }
  const normalized = description.trim();
  return normalized.length > 0 && normalized.length <= 1024;
}

function isValidMetadataField(metadataField: unknown): boolean {
  if (metadataField === undefined || metadataField === null) {
    return true;
  }
  if (typeof metadataField !== "object" || Array.isArray(metadataField)) {
    return false;
  }
  return Object.entries(metadataField as Record<string, unknown>).every(
    ([key, value]) => typeof key === "string" && typeof value === "string",
  );
}

function builtinSkillsRoot(): string[] {
  try {
    const bubSkills = require("bub_skills");
    return bubSkills.__path__ || [];
  } catch {
    return [];
  }
}

function iterSkillRoots(
  workspacePath: string,
): Array<{ root: string; source: "project" | "global" | "builtin" }> {
  const roots: Array<{
    root: string;
    source: "project" | "global" | "builtin";
  }> = [];

  for (const source of SKILL_SOURCES) {
    if (source === "project") {
      roots.push({
        root: path.join(workspacePath, PROJECT_SKILLS_DIR),
        source,
      });
      const legacyPath = path.join(workspacePath, LEGACY_SKILLS_DIR);
      if (fs.existsSync(legacyPath)) {
        console.warn(
          `Warning: Found legacy skills directory at '${legacyPath}'. Please move it to '${PROJECT_SKILLS_DIR}' to avoid this warning in the future.`,
        );
        roots.push({ root: legacyPath, source });
      }
    } else if (source === "global") {
      roots.push({
        root: path.join(
          process.env.HOME || process.env.USERPROFILE || "",
          PROJECT_SKILLS_DIR,
        ),
        source,
      });
    } else if (source === "builtin") {
      for (const p of builtinSkillsRoot()) {
        roots.push({ root: p, source });
      }
    }
  }

  return roots;
}

function readSkill(
  skillDir: string,
  source: "project" | "global" | "builtin",
): SkillMetadata | null {
  const skillFile = path.join(skillDir, SKILL_FILE_NAME);
  if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(skillFile, "utf-8").trim();
  } catch {
    return null;
  }

  const metadata = parseFrontmatter(content);
  if (!isValidFrontmatter(skillDir, metadata)) {
    return null;
  }

  const name = String(metadata.name).trim();
  const description = String(metadata.description).trim();

  const normalizedMetadata: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== null) {
      normalizedMetadata[key.toLowerCase()] = value;
    }
  }

  return {
    name,
    description,
    location: path.resolve(skillFile),
    source,
    metadata: normalizedMetadata,
  };
}

export function discoverSkills(workspacePath: string): SkillMetadata[] {
  const skillsByName: Record<string, SkillMetadata> = {};

  for (const { root, source } of iterSkillRoots(workspacePath)) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      continue;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }

    for (const entry of entries.sort()) {
      const skillDir = path.join(root, entry);
      if (!fs.statSync(skillDir).isDirectory()) {
        continue;
      }

      const metadata = readSkill(skillDir, source);
      if (metadata === null) {
        continue;
      }

      const key = metadata.name.toLowerCase();
      if (!(key in skillsByName)) {
        skillsByName[key] = metadata;
      }
    }
  }

  return Object.values(skillsByName).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

export function skillBody(location: string): string {
  const frontMatterPattern = /^---\s*\n[\s\S]*?\n---\s*\n/;
  try {
    const content = fs.readFileSync(location, "utf-8").trim();
    return content.replace(frontMatterPattern, "").trim();
  } catch {
    return "";
  }
}

export function renderSkillsPrompt(
  skills: SkillMetadata[],
  expandedSkills?: Set<string>,
): string {
  if (!skills || skills.length === 0) {
    return "";
  }

  const lines: string[] = ["<available_skills>"];
  for (const skill of skills) {
    let line = `- ${skill.name}: ${skill.description}`;
    if (expandedSkills && expandedSkills.has(skill.name)) {
      line += `  Location: ${skill.location}`;
      const body = skillBody(skill.location);
      if (body) {
        line += `\n${body}`;
      }
    }
    lines.push(line);
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}
