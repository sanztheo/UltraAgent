import { describe, expect, it } from "vitest";
import {
  parseVisualVerdict,
  buildVisualLoopFeedback,
} from "../../../src/visual/verdict.js";
import { VISUAL_NEXT_ACTIONS_LIMIT } from "../../../src/visual/constants.js";

function validPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    score: 85,
    verdict: "pass",
    category_match: true,
    differences: ["Minor spacing diff"],
    suggestions: ["Keep going"],
    reasoning: "Looks solid.",
    ...overrides,
  };
}

describe("parseVisualVerdict", () => {
  it("parses a valid payload", () => {
    const result = parseVisualVerdict(validPayload());
    expect(result.score).toBe(85);
    expect(result.verdict).toBe("pass");
    expect(result.category_match).toBe(true);
    expect(result.differences).toEqual(["Minor spacing diff"]);
    expect(result.suggestions).toEqual(["Keep going"]);
    expect(result.reasoning).toBe("Looks solid.");
  });

  it("normalizes verdict to lowercase", () => {
    const result = parseVisualVerdict(validPayload({ verdict: "REVISE" }));
    expect(result.verdict).toBe("revise");
  });

  it("trims whitespace from reasoning", () => {
    const result = parseVisualVerdict(
      validPayload({ reasoning: "  padded  " }),
    );
    expect(result.reasoning).toBe("padded");
  });

  it("filters empty strings from arrays", () => {
    const result = parseVisualVerdict(
      validPayload({ differences: ["real", "  ", ""], suggestions: ["  "] }),
    );
    expect(result.differences).toEqual(["real"]);
    expect(result.suggestions).toEqual([]);
  });

  it("rejects null input", () => {
    expect(() => parseVisualVerdict(null)).toThrow("must be an object");
  });

  it("rejects non-integer score", () => {
    expect(() => parseVisualVerdict(validPayload({ score: 90.5 }))).toThrow(
      "integer between 0 and 100",
    );
  });

  it("rejects score out of range", () => {
    expect(() => parseVisualVerdict(validPayload({ score: 101 }))).toThrow(
      "integer between 0 and 100",
    );
    expect(() => parseVisualVerdict(validPayload({ score: -1 }))).toThrow(
      "integer between 0 and 100",
    );
  });

  it("rejects invalid verdict status", () => {
    expect(() =>
      parseVisualVerdict(validPayload({ verdict: "approve" })),
    ).toThrow("pass|revise|fail");
  });

  it("rejects non-boolean category_match", () => {
    expect(() =>
      parseVisualVerdict(validPayload({ category_match: "yes" })),
    ).toThrow("category_match must be a boolean");
  });

  it("rejects empty reasoning", () => {
    expect(() =>
      parseVisualVerdict(validPayload({ reasoning: "   " })),
    ).toThrow("reasoning must be a non-empty string");
  });

  it("rejects non-array differences", () => {
    expect(() =>
      parseVisualVerdict(validPayload({ differences: "oops" })),
    ).toThrow("differences must be an array");
  });

  it("rejects non-string items in suggestions", () => {
    expect(() =>
      parseVisualVerdict(validPayload({ suggestions: [42] })),
    ).toThrow("suggestions must contain strings");
  });
});

describe("buildVisualLoopFeedback", () => {
  it("passes threshold at default 90", () => {
    const result = buildVisualLoopFeedback(validPayload({ score: 94 }));
    expect(result.passes_threshold).toBe(true);
    expect(result.threshold).toBe(90);
  });

  it("fails threshold below 90", () => {
    const result = buildVisualLoopFeedback(validPayload({ score: 78 }));
    expect(result.passes_threshold).toBe(false);
  });

  it("respects custom threshold", () => {
    const result = buildVisualLoopFeedback(validPayload({ score: 78 }), 70);
    expect(result.passes_threshold).toBe(true);
    expect(result.threshold).toBe(70);
  });

  it("builds next_actions from suggestions + differences", () => {
    const result = buildVisualLoopFeedback(
      validPayload({
        suggestions: ["Do A"],
        differences: ["Gap B"],
      }),
    );
    expect(result.next_actions).toEqual(["Do A", "Fix: Gap B"]);
  });

  it("limits next_actions to VISUAL_NEXT_ACTIONS_LIMIT", () => {
    const many = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const result = buildVisualLoopFeedback(
      validPayload({ suggestions: many, differences: many }),
    );
    expect(result.next_actions.length).toBeLessThanOrEqual(
      VISUAL_NEXT_ACTIONS_LIMIT,
    );
  });
});
