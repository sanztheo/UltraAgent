import { describe, expect, it } from "vitest";
import { isScalingEnabled } from "../../../src/team/scaling.js";

describe("scaling", () => {
  describe("isScalingEnabled", () => {
    it("returns false when env not set", () => {
      expect(isScalingEnabled({})).toBe(false);
    });

    it("returns true for '1'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "1" })).toBe(true);
    });

    it("returns true for 'true'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "true" })).toBe(
        true,
      );
    });

    it("returns true for 'yes'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "yes" })).toBe(
        true,
      );
    });

    it("returns true for 'on'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "on" })).toBe(true);
    });

    it("returns true for 'enabled'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "enabled" })).toBe(
        true,
      );
    });

    it("returns false for '0'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "0" })).toBe(false);
    });

    it("returns false for 'false'", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "false" })).toBe(
        false,
      );
    });

    it("returns false for random string", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "maybe" })).toBe(
        false,
      );
    });

    it("handles whitespace", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "  TRUE  " })).toBe(
        true,
      );
    });

    it("case insensitive", () => {
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "True" })).toBe(
        true,
      );
      expect(isScalingEnabled({ ULTRA_TEAM_SCALING_ENABLED: "YES" })).toBe(
        true,
      );
    });
  });
});
