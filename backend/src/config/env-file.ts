import * as fs from 'fs';
import * as path from 'path';

/**
 * 极简 .env 解析器（不引入 dotenv 依赖，行为可预测）。
 * 规则：
 *  - 忽略空行与以 # 开头的注释行
 *  - 支持 KEY=VALUE、export KEY=VALUE、KEY="VALUE"、KEY='VALUE'
 *  - 已存在的 process.env 优先级最高（容器/CI 注入的环境变量不会被文件覆盖）
 *  - 支持 # 行尾注释（仅当值未被引号包裹时）
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (key) result[key] = value;
  }
  return result;
}

/** 按顺序加载多个 .env 文件，先加载者优先（不覆盖已有环境变量） */
export function loadEnvFiles(files: string[]): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

export const PROJECT_ROOT = path.resolve(__dirname, '../../..');
