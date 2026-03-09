import { describe, expect, it } from "vitest";
import {
  determineTaskSize,
  getFixLoopInstructions,
  getVerificationInstructions,
  hasStructuredVerificationEvidence,
} from "../../../src/verification/verifier.js";

describe("verifier", () => {
  describe("hasStructuredVerificationEvidence", () => {
    it("returns false for null/undefined", () => {
      expect(hasStructuredVerificationEvidence(null)).toBe(false);
      expect(hasStructuredVerificationEvidence(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(hasStructuredVerificationEvidence("")).toBe(false);
    });

    it("returns false without verification section", () => {
      expect(hasStructuredVerificationEvidence("All tests passed")).toBe(false);
    });

    it("returns true with verification section + evidence", () => {
      const summary = `## Verification
- test: passed
- build: \`npm run build\` passed`;
      expect(hasStructuredVerificationEvidence(summary)).toBe(true);
    });

    it("returns true with inline verification header", () => {
      const summary = "Verification evidence: test passed, build ok";
      expect(hasStructuredVerificationEvidence(summary)).toBe(true);
    });

    it("returns false with section header but no evidence signals", () => {
      const summary = "## Verification\nEverything looks good.";
      expect(hasStructuredVerificationEvidence(summary)).toBe(false);
    });
  });

  describe("determineTaskSize", () => {
    it("small: few files, few changes", () => {
      expect(determineTaskSize(2, 50)).toBe("small");
    });

    it("standard: moderate files and changes", () => {
      expect(determineTaskSize(10, 300)).toBe("standard");
    });

    it("large: many files or many changes", () => {
      expect(determineTaskSize(20, 1000)).toBe("large");
    });

    it("boundary: 3 files, 99 lines is small", () => {
      expect(determineTaskSize(3, 99)).toBe("small");
    });

    it("boundary: 4 files pushes to standard", () => {
      expect(determineTaskSize(4, 50)).toBe("standard");
    });
  });

  describe("getVerificationInstructions", () => {
    it("small: minimal checks", () => {
      const instructions = getVerificationInstructions("small", "fix typo");
      expect(instructions).toContain("fix typo");
      expect(instructions).toContain("PASS/FAIL");
      expect(instructions).not.toContain("Security review");
    });

    it("standard: includes linter", () => {
      const instructions = getVerificationInstructions(
        "standard",
        "add feature",
      );
      expect(instructions).toContain("linter");
      expect(instructions).toContain("end-to-end");
    });

    it("large: includes security and performance", () => {
      const instructions = getVerificationInstructions(
        "large",
        "rewrite module",
      );
      expect(instructions).toContain("Security review");
      expect(instructions).toContain("Performance");
      expect(instructions).toContain("confidence level");
    });
  });

  describe("getFixLoopInstructions", () => {
    it("includes max retries count", () => {
      const instructions = getFixLoopInstructions(5);
      expect(instructions).toContain("5 times");
      expect(instructions).toContain("5 attempts");
    });

    it("defaults to 3 retries", () => {
      const instructions = getFixLoopInstructions();
      expect(instructions).toContain("3 times");
    });
  });
});
