import { describe, expect, it } from "vitest";
import { type ConfigEnv, checkNe26Config } from "./configCheck";

const HEALTHY: ConfigEnv = {
  STRIPE_PRIVATE_KEY: "sk_live_abc123",
  STRIPE_WEBHOOK_SECRET_NE26_ROOMS: "whsec_abc123",
  NE26_INVOICE_DIR: "/data/ne26-invoices",
  EMAIL_FROM: "noreply@vo-europe.eu",
  EMAIL_SERVER_HOST: "smtp.example.com",
  CALENDSO_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
};

function keys(env: ConfigEnv): string[] {
  return checkNe26Config(env).map((i) => i.key);
}

describe("checkNe26Config", () => {
  it("says nothing when the deployment is sound", () => {
    expect(checkNe26Config(HEALTHY)).toEqual([]);
  });

  it("treats a missing webhook secret as an error, not a warning", () => {
    // Money is captured and the booking never confirms — the worst outcome the
    // app has, and completely silent without this.
    const issues = checkNe26Config({ ...HEALTHY, STRIPE_WEBHOOK_SECRET_NE26_ROOMS: undefined });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "error", key: "STRIPE_WEBHOOK_SECRET_NE26_ROOMS" });
  });

  it("flags test-mode Stripe keys", () => {
    const issues = checkNe26Config({ ...HEALTHY, STRIPE_PRIVATE_KEY: "sk_test_abc123" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "warning", key: "STRIPE_PRIVATE_KEY" });
  });

  it("flags an unmounted invoice directory — the PDFs are accounting documents", () => {
    expect(keys({ ...HEALTHY, NE26_INVOICE_DIR: undefined })).toContain("NE26_INVOICE_DIR");
  });

  it("flags email redirection, which silently swallows every invoice", () => {
    const issues = checkNe26Config({ ...HEALTHY, NE26_EMAIL_REDIRECT_TO: "tim@example.com" });
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].title).toContain("tim@example.com");
  });

  it("flags a wrong-length encryption key without demanding one be set here", () => {
    expect(keys({ ...HEALTHY, CALENDSO_ENCRYPTION_KEY: "too-short" })).toContain("CALENDSO_ENCRYPTION_KEY");
    // Absent is Cal's own concern, not this check's.
    expect(keys({ ...HEALTHY, CALENDSO_ENCRYPTION_KEY: undefined })).not.toContain(
      "CALENDSO_ENCRYPTION_KEY"
    );
  });

  it("treats whitespace as unset", () => {
    expect(keys({ ...HEALTHY, STRIPE_PRIVATE_KEY: "   " })).toContain("STRIPE_PRIVATE_KEY");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    expect(checkNe26Config({}).length).toBeGreaterThanOrEqual(4);
  });
});
