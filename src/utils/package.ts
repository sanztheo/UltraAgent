/**
 * Package root resolution — works from dist/, src/, or bin/.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getPackageRoot(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);

    // From dist/utils/ or src/utils/ → go up two levels
    const candidate = join(thisDir, '..', '..');
    if (existsSync(join(candidate, 'package.json'))) return candidate;

    // From bin/ → go up one level
    const candidate2 = join(thisDir, '..');
    if (existsSync(join(candidate2, 'package.json'))) return candidate2;
  } catch {
    // Fallback to cwd
  }
  return process.cwd();
}
