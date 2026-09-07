import { describe, expect, it } from "vitest";
import { PASSWORD_HINT, passwordChecklist, passwordProblem, signupIssueMessage } from "./passwordRules";

describe("passwordProblem", () => {
  it("accepts a password that meets every rule", () => {
    expect(passwordProblem("Exhibitor26")).toBeNull();
  });

  it("names the lowercase letter the hint used to leave out", () => {
    // The one that started this: a password with a capital and a number, which
    // satisfied everything the screen asked for, and was refused anyway.
    expect(passwordProblem("NATOEDGE26")).toBe(
      "Your password needs an uppercase and a lowercase letter."
    );
  });

  it("names a missing number", () => {
    expect(passwordProblem("Exhibitors")).toBe("Your password needs a number.");
  });

  it("names a password that is too short", () => {
    expect(passwordProblem("Ab1")).toBe("Your password needs at least 7 characters.");
  });

  it("reads as one sentence when several rules fail", () => {
    expect(passwordProblem("abc")).toBe(
      "Your password needs at least 7 characters, an uppercase and a lowercase letter and a number."
    );
  });

  it("never answers with an empty complaint", () => {
    for (const candidate of ["", "a", "A1", "aaaaaaaa", "AAAAAAAA", "12345678", "Exhibitor26"]) {
      const problem = passwordProblem(candidate);
      expect(problem === null || problem.length > 20, candidate).toBe(true);
    }
  });
});

describe("the hint matches what is enforced", () => {
  it("describes a password the rules actually accept", () => {
    // A hint that disagrees with the rule is how this went wrong in the first
    // place, so the hint is checked against the rule rather than trusted.
    expect(passwordProblem("Password1")).toBeNull();
    expect(PASSWORD_HINT).toContain("uppercase");
    expect(PASSWORD_HINT).toContain("lowercase");
    expect(PASSWORD_HINT).toContain("number");
    expect(PASSWORD_HINT).toContain("7");
  });
});

describe("signupIssueMessage", () => {
  it("turns the schema's rule flags into something readable", () => {
    // What the API actually receives: the message IS the flag name.
    const issues = [{ path: ["password", "caplow"], message: "caplow" }];
    expect(signupIssueMessage(issues)).toBe("Your password needs an uppercase and a lowercase letter.");
  });

  it("joins several failed rules", () => {
    const issues = [
      { path: ["password", "min"], message: "min" },
      { path: ["password", "num"], message: "num" },
    ];
    expect(signupIssueMessage(issues)).toBe("Your password needs at least 7 characters and a number.");
  });

  it("passes through a message that is already readable", () => {
    expect(signupIssueMessage([{ path: ["email"], message: "Invalid email" }])).toBe("Invalid email");
  });

  it("says nothing rather than something empty when it cannot phrase the issue", () => {
    expect(signupIssueMessage([])).toBeNull();
    expect(signupIssueMessage([{ path: ["password", "unknown_rule"], message: "unknown_rule" }])).toBeNull();
  });

  it("never leaks a raw rule flag to the visitor", () => {
    const message = signupIssueMessage([{ path: ["password", "caplow"], message: "caplow" }]);
    expect(message).not.toContain("caplow");
  });
});

describe("passwordChecklist", () => {
  const met = (password: string) => passwordChecklist(password).filter((c) => c.met).length;

  it("separates the capital from the lowercase, which Cal reports as one rule", () => {
    // The half people get wrong. Told as a single line it reads as satisfied by
    // either one, which is how a password with a capital and no lowercase was
    // typed with confidence and then refused.
    const labels = passwordChecklist("NATOEDGE26").filter((c) => !c.met).map((c) => c.label);
    expect(labels).toEqual(["A lowercase letter"]);
  });

  it("ticks nothing for an empty field and everything for a good password", () => {
    expect(met("")).toBe(0);
    expect(met("Exhibitor26")).toBe(4);
  });

  it("agrees with the rule the server enforces, in both directions", () => {
    // The list is written out by hand, so it could drift from what actually
    // gets accepted. A visitor watching four ticks go green and then being
    // refused would have no idea what to do next.
    const candidates = [
      "", "a", "A", "1", "Ab1", "Abcdef1", "abcdefg1", "ABCDEFG1", "Abcdefgh",
      "NATOEDGE26", "Exhibitor26", "Password1", "aB3", "aaaaaaaA", "1234567A",
      "1234567a", "éÉ123456", "        A1a", "Ne26!!!!x1",
    ];
    for (const candidate of candidates) {
      const allTicked = passwordChecklist(candidate).every((c) => c.met);
      expect(allTicked, `${JSON.stringify(candidate)}`).toBe(passwordProblem(candidate) === null);
    }
  });
});
