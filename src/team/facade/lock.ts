/**
 * Facade: team-wide lock bound to `cwd`.
 */

import { teamDir } from "../../utils/paths.js";
import { withTeamLock } from "../state/locks.js";

export async function withLock<T>(
  cwd: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withTeamLock(teamDir(cwd), fn);
}
