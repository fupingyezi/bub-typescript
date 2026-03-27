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

/**
 * 解析 SKILL.md 文件头部的 YAML frontmatter，返回元数据键值对。
 * frontmatter 格式为两行 `---` 之间的 YAML 内容。
 * 所有键名统一转换为小写。
 * @param content - SKILL.md 文件的完整文本内容
 * @returns 解析后的元数据对象，解析失败时返回空对象
 */
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

/**
 * 校验 skill 目录的 frontmatter 元数据是否合法。
 * 要求 `name`、`description` 字段有效，且可选的 `metadata` 字段格式正确。
 * @param skillDir - skill 目录的绝对路径
 * @param metadata - 已解析的 frontmatter 元数据
 * @returns 元数据合法时返回 `true`，否则返回 `false`
 */
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

/**
 * 校验 skill 名称是否合法。
 * 要求：字符串类型、非空、长度不超过 64、与目录名一致、符合 `SKILL_NAME_PATTERN` 正则。
 * @param name - 待校验的名称
 * @param skillDir - skill 所在目录路径（用于与目录名比对）
 * @returns 名称合法时返回 `true`
 */
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

/**
 * 校验 skill 描述是否合法。
 * 要求：字符串类型、非空、长度不超过 1024。
 * @param description - 待校验的描述
 * @returns 描述合法时返回 `true`
 */
function isValidDescription(description: unknown): boolean {
  if (typeof description !== "string") {
    return false;
  }
  const normalized = description.trim();
  return normalized.length > 0 && normalized.length <= 1024;
}

/**
 * 校验 frontmatter 中可选的 `metadata` 字段是否合法。
 * 允许为 `undefined`/`null`；若存在，必须是键值均为字符串的普通对象（非数组）。
 * @param metadataField - 待校验的 metadata 字段值
 * @returns 字段合法时返回 `true`
 */
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

/**
 * 获取内置 skill 包（`bub_skills`）的根目录列表。
 * 若包未安装则返回空数组。
 * @returns 内置 skill 根目录路径数组
 */
function builtinSkillsRoot(): string[] {
  try {
    const bubSkills = require("bub_skills");
    return bubSkills.__path__ || [];
  } catch {
    return [];
  }
}

/**
 * 枚举所有 skill 搜索根目录及其来源类型。
 * 按 `project → global → builtin` 顺序返回，project 来源还会检查旧版目录。
 * @param workspacePath - 当前工作区绝对路径
 * @returns 根目录与来源类型的数组
 */
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

/**
 * 读取单个 skill 目录，解析并校验其 SKILL.md 文件，返回元数据对象。
 * @param skillDir - skill 目录的绝对路径
 * @param source - skill 来源类型
 * @returns 解析成功时返回 `SkillMetadata`，否则返回 `null`
 */
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

/**
 * 在给定工作区路径下发现所有可用的 skill，按名称去重（project 优先）并按名称排序。
 * @param workspacePath - 工作区绝对路径
 * @returns 去重后按名称排序的 `SkillMetadata` 数组
 */
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

/**
 * 读取 skill 文件的正文内容（去除 frontmatter 部分）。
 * @param location - SKILL.md 文件的绝对路径
 * @returns skill 正文字符串，读取失败时返回空字符串
 */
export function skillBody(location: string): string {
  const frontMatterPattern = /^---\s*\n[\s\S]*?\n---\s*\n/;
  try {
    const content = fs.readFileSync(location, "utf-8").trim();
    return content.replace(frontMatterPattern, "").trim();
  } catch {
    return "";
  }
}

/**
 * 将 skill 列表渲染为系统提示词中的 `<available_skills>` XML 块。
 * 若 `expandedSkills` 中包含某 skill 名称，则在列表项后附加其完整正文。
 * @param skills - skill 元数据列表
 * @param expandedSkills - 需要展开正文的 skill 名称集合（可选）
 * @returns skill 列表的提示词字符串，若列表为空则返回空字符串
 */
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
