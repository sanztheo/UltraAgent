import { afterEach, describe, expect, it } from "vitest";
import {
  RESET,
  green,
  yellow,
  cyan,
  dim,
  bold,
  red,
  getProgressColor,
  setColorEnabled,
} from "../../../src/hud/colors.js";

const GREEN_CODE = "\x1b[32m";
const YELLOW_CODE = "\x1b[33m";
const RED_CODE = "\x1b[31m";
const CYAN_CODE = "\x1b[36m";
const DIM_CODE = "\x1b[2m";
const BOLD_CODE = "\x1b[1m";

afterEach(() => {
  setColorEnabled(true);
});

describe("RESET", () => {
  it("is the ANSI reset escape code", () => {
    expect(RESET).toBe("\x1b[0m");
  });
});

describe("color wrappers", () => {
  it("green wraps with green codes", () => {
    expect(green("ok")).toBe(`${GREEN_CODE}ok${RESET}`);
  });

  it("yellow wraps with yellow codes", () => {
    expect(yellow("warn")).toBe(`${YELLOW_CODE}warn${RESET}`);
  });

  it("cyan wraps with cyan codes", () => {
    expect(cyan("info")).toBe(`${CYAN_CODE}info${RESET}`);
  });

  it("dim wraps with dim codes", () => {
    expect(dim("muted")).toBe(`${DIM_CODE}muted${RESET}`);
  });

  it("bold wraps with bold codes", () => {
    expect(bold("strong")).toBe(`${BOLD_CODE}strong${RESET}`);
  });

  it("red wraps with red codes", () => {
    expect(red("error")).toBe(`${RED_CODE}error${RESET}`);
  });

  it("handles empty strings", () => {
    expect(green("")).toBe(`${GREEN_CODE}${RESET}`);
  });

  it("returns plain text when colors disabled", () => {
    setColorEnabled(false);
    expect(green("ok")).toBe("ok");
    expect(bold("strong")).toBe("strong");
  });
});

describe("getProgressColor", () => {
  it("returns GREEN below warning threshold", () => {
    expect(getProgressColor(0, 10)).toBe(GREEN_CODE);
    expect(getProgressColor(6, 10)).toBe(GREEN_CODE);
  });

  it("returns YELLOW at warning threshold (70%)", () => {
    expect(getProgressColor(7, 10)).toBe(YELLOW_CODE);
    expect(getProgressColor(8, 10)).toBe(YELLOW_CODE);
  });

  it("returns RED at critical threshold (90%)", () => {
    expect(getProgressColor(9, 10)).toBe(RED_CODE);
    expect(getProgressColor(10, 10)).toBe(RED_CODE);
  });

  it("handles exact boundaries with 100 max", () => {
    expect(getProgressColor(69, 100)).toBe(GREEN_CODE);
    expect(getProgressColor(70, 100)).toBe(YELLOW_CODE);
    expect(getProgressColor(89, 100)).toBe(YELLOW_CODE);
    expect(getProgressColor(90, 100)).toBe(RED_CODE);
  });

  it("handles floor rounding", () => {
    // max=7: warning=floor(4.9)=4, critical=floor(6.3)=6
    expect(getProgressColor(3, 7)).toBe(GREEN_CODE);
    expect(getProgressColor(4, 7)).toBe(YELLOW_CODE);
    expect(getProgressColor(6, 7)).toBe(RED_CODE);
  });

  it("returns empty string when colors disabled", () => {
    setColorEnabled(false);
    expect(getProgressColor(5, 10)).toBe("");
  });
});
