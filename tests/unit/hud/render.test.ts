import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHud } from "../../../src/hud/render.js";
import type { HudRenderContext } from "../../../src/hud/types.js";
import { setColorEnabled } from "../../../src/hud/colors.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

afterEach(() => {
  setColorEnabled(true);
  vi.restoreAllMocks();
});

function emptyCtx(): HudRenderContext {
  return {
    version: null,
    gitBranch: null,
    loop: null,
    refinement: null,
    autopilot: null,
    team: null,
    metrics: null,
    hudNotify: null,
    session: null,
  };
}

describe("renderHud — empty context", () => {
  it("shows 'No active modes.' when nothing is active", () => {
    const result = renderHud(emptyCtx(), "focused");
    expect(result).toContain("No active modes.");
  });

  it("includes the [UA] label", () => {
    const result = renderHud(emptyCtx(), "focused");
    expect(result).toContain("[UA]");
  });

  it("renders plain text when colors are disabled", () => {
    setColorEnabled(false);
    const result = renderHud(emptyCtx(), "focused");
    expect(/\x1b\[[0-9;]*m/.test(result)).toBe(false);
    expect(result).toContain("[UA]");
  });
});

describe("renderHud — version", () => {
  it("strips the 'v' prefix from semver", () => {
    const ctx = { ...emptyCtx(), version: "v1.2.3" };
    expect(renderHud(ctx, "focused")).toContain("[UA#1.2.3]");
  });

  it("keeps plain version as-is", () => {
    const ctx = { ...emptyCtx(), version: "2.0.0" };
    expect(renderHud(ctx, "focused")).toContain("[UA#2.0.0]");
  });

  it("omits hash suffix when version is null", () => {
    const result = renderHud(emptyCtx(), "focused");
    expect(result).toContain("[UA]");
    expect(result).not.toContain("[UA#");
  });
});

describe("renderHud — gitBranch", () => {
  it("renders branch in cyan", () => {
    const ctx = { ...emptyCtx(), gitBranch: "main" };
    expect(renderHud(ctx, "focused")).toContain(`${CYAN}main${RESET}`);
  });

  it("omits branch when null", () => {
    expect(renderHud(emptyCtx(), "focused")).not.toContain("main");
  });
});

describe("renderHud — loop", () => {
  it("renders loop iteration info", () => {
    const ctx = {
      ...emptyCtx(),
      loop: { active: true, iteration: 3, max_iterations: 10 },
    };
    expect(renderHud(ctx, "focused")).toContain("loop:3/10");
  });

  it("omits loop when null", () => {
    expect(renderHud(emptyCtx(), "focused")).not.toContain("loop");
  });
});

describe("renderHud — refinement", () => {
  it("renders 'refinement' in cyan", () => {
    const ctx = { ...emptyCtx(), refinement: { active: true } };
    expect(renderHud(ctx, "focused")).toContain(`${CYAN}refinement${RESET}`);
  });

  it("omits refinement when null", () => {
    expect(renderHud(emptyCtx(), "focused")).not.toContain("refinement");
  });
});

describe("renderHud — autopilot", () => {
  it("renders autopilot with phase", () => {
    const ctx = {
      ...emptyCtx(),
      autopilot: { active: true, current_phase: "planning" },
    };
    expect(renderHud(ctx, "focused")).toContain(
      `${YELLOW}autopilot:planning${RESET}`,
    );
  });

  it("defaults phase to 'active'", () => {
    const ctx = { ...emptyCtx(), autopilot: { active: true } };
    expect(renderHud(ctx, "focused")).toContain("autopilot:active");
  });
});

describe("renderHud — team", () => {
  it("renders agent count", () => {
    const ctx = { ...emptyCtx(), team: { active: true, agent_count: 3 } };
    expect(renderHud(ctx, "focused")).toContain(
      `${GREEN}team:3 workers${RESET}`,
    );
  });

  it("renders team name when count absent", () => {
    const ctx = {
      ...emptyCtx(),
      team: { active: true, team_name: "my-team" },
    };
    expect(renderHud(ctx, "focused")).toContain(`${GREEN}team:my-team${RESET}`);
  });

  it("renders bare 'team' when neither set", () => {
    const ctx = { ...emptyCtx(), team: { active: true } };
    expect(renderHud(ctx, "focused")).toContain(`${GREEN}team${RESET}`);
  });

  it("skips count when agent_count is 0", () => {
    const ctx = {
      ...emptyCtx(),
      team: { active: true, agent_count: 0 },
    };
    const result = renderHud(ctx, "focused");
    expect(result).not.toContain("workers");
    expect(result).toContain(`${GREEN}team${RESET}`);
  });
});

describe("renderHud — metrics", () => {
  it("renders turn count", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: { total_turns: 100, session_turns: 5, last_activity: "" },
    };
    expect(renderHud(ctx, "focused")).toContain("turns:5");
  });

  it("skips stale metrics (last_activity before session start)", () => {
    const ctx = {
      ...emptyCtx(),
      session: { session_id: "s1", started_at: "2024-06-01T10:00:00Z" },
      metrics: {
        total_turns: 50,
        session_turns: 3,
        last_activity: "2024-06-01T09:00:00Z",
      },
    };
    expect(renderHud(ctx, "focused")).not.toContain("turns:3");
  });

  it("renders tokens formatted as 'k'", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        session_total_tokens: 5000,
      },
    };
    expect(renderHud(ctx, "focused")).toContain("tokens:5.0k");
  });

  it("sums input+output when total absent", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        session_input_tokens: 2000,
        session_output_tokens: 3000,
      },
    };
    expect(renderHud(ctx, "focused")).toContain("tokens:5.0k");
  });

  it("formats millions", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        session_total_tokens: 2_500_000,
      },
    };
    expect(renderHud(ctx, "focused")).toContain("tokens:2.5M");
  });

  it("omits tokens when total is 0", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        session_total_tokens: 0,
      },
    };
    expect(renderHud(ctx, "focused")).not.toContain("tokens");
  });
});

describe("renderHud — quota", () => {
  it("renders both 5-hour and weekly limits", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        five_hour_limit_pct: 42.7,
        weekly_limit_pct: 15.3,
      },
    };
    expect(renderHud(ctx, "focused")).toContain("quota:5h:43%,wk:15%");
  });

  it("omits quota when both limits are 0", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        five_hour_limit_pct: 0,
        weekly_limit_pct: 0,
      },
    };
    expect(renderHud(ctx, "focused")).not.toContain("quota");
  });
});

describe("renderHud — last activity", () => {
  it("renders in seconds", () => {
    const fixedNow = 1_700_000_030_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const ctx = {
      ...emptyCtx(),
      hudNotify: {
        last_turn_at: new Date(fixedNow - 30_000).toISOString(),
        turn_count: 5,
      },
    };
    expect(renderHud(ctx, "focused")).toContain("last:30s ago");
  });

  it("renders in minutes", () => {
    const fixedNow = 1_700_000_120_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const ctx = {
      ...emptyCtx(),
      hudNotify: {
        last_turn_at: new Date(fixedNow - 120_000).toISOString(),
        turn_count: 5,
      },
    };
    expect(renderHud(ctx, "focused")).toContain("last:2m ago");
  });

  it("omits when invalid timestamp", () => {
    const ctx = {
      ...emptyCtx(),
      hudNotify: { last_turn_at: "not-a-date", turn_count: 5 },
    };
    expect(renderHud(ctx, "focused")).not.toContain("last:");
  });
});

describe("renderHud — session duration", () => {
  it("renders in seconds", () => {
    const fixedNow = 1_700_000_030_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const ctx = {
      ...emptyCtx(),
      session: {
        session_id: "s1",
        started_at: new Date(fixedNow - 30_000).toISOString(),
      },
    };
    expect(renderHud(ctx, "focused")).toContain("session:30s");
  });

  it("renders in hours and minutes", () => {
    const fixedNow = 1_700_010_920_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const ctx = {
      ...emptyCtx(),
      session: {
        session_id: "s1",
        started_at: new Date(fixedNow - 7_320_000).toISOString(),
      },
    };
    expect(renderHud(ctx, "focused")).toContain("session:2h2m");
  });

  it("omits when session is null", () => {
    expect(renderHud(emptyCtx(), "focused")).not.toContain("session:");
  });
});

describe("renderHud — total turns (full preset)", () => {
  it("renders total-turns in full preset", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: { total_turns: 200, session_turns: 5, last_activity: "" },
    };
    expect(renderHud(ctx, "full")).toContain("total-turns:200");
  });

  it("omits total-turns in focused preset", () => {
    const ctx = {
      ...emptyCtx(),
      metrics: { total_turns: 200, session_turns: 5, last_activity: "" },
    };
    expect(renderHud(ctx, "focused")).not.toContain("total-turns");
  });
});

describe("renderHud — presets", () => {
  it("minimal includes branch, loop, refinement, team, turns", () => {
    const ctx = {
      ...emptyCtx(),
      gitBranch: "feat/x",
      loop: { active: true, iteration: 1, max_iterations: 5 },
      refinement: { active: true },
      team: { active: true, agent_count: 2 },
      metrics: { total_turns: 10, session_turns: 3, last_activity: "" },
    };
    const result = renderHud(ctx, "minimal");
    expect(result).toContain("feat/x");
    expect(result).toContain("loop:1/5");
    expect(result).toContain("refinement");
    expect(result).toContain("workers");
    expect(result).toContain("turns:3");
  });

  it("minimal excludes autopilot and quota", () => {
    const ctx = {
      ...emptyCtx(),
      autopilot: { active: true, current_phase: "exec" },
      metrics: {
        total_turns: 10,
        session_turns: 3,
        last_activity: "",
        five_hour_limit_pct: 50,
      },
    };
    const result = renderHud(ctx, "minimal");
    expect(result).not.toContain("autopilot");
    expect(result).not.toContain("quota");
  });
});

describe("renderHud — separator", () => {
  it("joins elements with dim pipe", () => {
    const ctx = {
      ...emptyCtx(),
      gitBranch: "main",
      loop: { active: true, iteration: 2, max_iterations: 10 },
    };
    expect(renderHud(ctx, "focused")).toContain(`${DIM} | ${RESET}`);
  });

  it("no separator for single element", () => {
    const ctx = { ...emptyCtx(), gitBranch: "solo" };
    expect(renderHud(ctx, "focused")).not.toContain(" | ");
  });
});

describe("renderHud — sanitization", () => {
  it("strips control characters from dynamic text", () => {
    const injected =
      "safe\x1b]8;;https://evil.example\x07click\x1b]8;;\x07\nnext";
    const ctx = {
      ...emptyCtx(),
      gitBranch: injected,
      autopilot: { active: true, current_phase: injected },
      team: { active: true, team_name: injected },
    };
    const plain = stripAnsi(renderHud(ctx, "focused"));
    expect(plain).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  });
});
