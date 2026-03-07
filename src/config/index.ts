import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { globalConfigDir, globalConfigPath, projectConfigPath } from '../utils/paths.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { ultraAgentConfigSchema } from './schema.js';
import type { UltraAgentConfig } from './types.js';

export function loadConfig(cwd: string): UltraAgentConfig {
  const globalPath = globalConfigPath();
  const projectPath = projectConfigPath(cwd);

  const globalConfig = loadJsonFile(globalPath);
  const projectConfig = loadJsonFile(projectPath);

  const merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, globalConfig, projectConfig);

  const result = ultraAgentConfigSchema.safeParse(merged);
  if (!result.success) {
    logger.error(`Invalid config: ${result.error.message}`, 'config');
    throw new Error(`Invalid UltraAgent configuration: ${result.error.message}`);
  }

  return result.data;
}

export function saveConfig(config: UltraAgentConfig, scope: 'global' | 'project', cwd: string): void {
  const validated = ultraAgentConfigSchema.parse(config);

  if (scope === 'global') {
    const dir = globalConfigDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(globalConfigPath(), JSON.stringify(validated, null, 2) + '\n');
    logger.info(`Global config saved to ${globalConfigPath()}`, 'config');
  } else {
    writeFileSync(projectConfigPath(cwd), JSON.stringify(validated, null, 2) + '\n');
    logger.info(`Project config saved to ${projectConfigPath(cwd)}`, 'config');
  }
}

export function configExists(cwd: string): boolean {
  return existsSync(globalConfigPath()) || existsSync(projectConfigPath(cwd));
}

function loadJsonFile(filepath: string): Record<string, unknown> {
  if (!existsSync(filepath)) {
    return {};
  }
  try {
    const content = readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    logger.warn(`Failed to parse ${filepath}: ${error instanceof Error ? error.message : String(error)}`, 'config');
    return {};
  }
}

function deepMerge(...objects: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = deepMerge(result[key] as Record<string, unknown>, value);
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { UltraAgentConfig } from './types.js';
export { DEFAULT_CONFIG } from './defaults.js';
