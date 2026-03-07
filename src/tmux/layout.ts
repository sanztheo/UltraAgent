import type { TmuxLayout } from "../config/types.js";
import { tmuxSelectLayout, tmuxListPanes, tmuxSelectPane } from "./commands.js";
import { logger } from "../utils/logger.js";

export interface LayoutStrategy {
  apply(sessionName: string, paneCount: number): Promise<void>;
}

function createTiledLayout(): LayoutStrategy {
  return {
    async apply(sessionName: string): Promise<void> {
      await tmuxSelectLayout(sessionName, "tiled");
    },
  };
}

function createMainVerticalLayout(): LayoutStrategy {
  return {
    async apply(sessionName: string, paneCount: number): Promise<void> {
      if (paneCount < 2) {
        return;
      }
      // Chef gets 50% left, workers stacked on the right
      await tmuxSelectLayout(sessionName, "main-vertical");

      // Select the first pane (chef) and resize to 50% width
      const panes = await tmuxListPanes(sessionName);
      const first = panes[0];
      if (first) {
        await tmuxSelectPane(first.id);
      }
      logger.debug(
        `Applied main-vertical layout (${paneCount} panes)`,
        "layout",
      );
    },
  };
}

function createMainHorizontalLayout(): LayoutStrategy {
  return {
    async apply(sessionName: string, paneCount: number): Promise<void> {
      if (paneCount < 2) {
        return;
      }
      // Chef gets 50% top, workers stacked on the bottom
      await tmuxSelectLayout(sessionName, "main-horizontal");

      const panes = await tmuxListPanes(sessionName);
      const first = panes[0];
      if (first) {
        await tmuxSelectPane(first.id);
      }
      logger.debug(
        `Applied main-horizontal layout (${paneCount} panes)`,
        "layout",
      );
    },
  };
}

export function createLayout(type: TmuxLayout): LayoutStrategy {
  switch (type) {
    case "tiled":
      return createTiledLayout();
    case "main-vertical":
      return createMainVerticalLayout();
    case "main-horizontal":
      return createMainHorizontalLayout();
  }
}
