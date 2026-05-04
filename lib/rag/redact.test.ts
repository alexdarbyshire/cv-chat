import { describe, expect, it } from "vitest";
import { redactPii } from "./redact";

describe("redactPii", () => {
  it("redacts email addresses", () => {
    const { text, stats } = redactPii("Contact: alex@example.com or bob@a.io");
    expect(text).toBe("Contact: [REDACTED-EMAIL] or [REDACTED-EMAIL]");
    expect(stats.emails).toBe(2);
  });

  it("redacts AU mobile numbers in common formats", () => {
    const cases = [
      "Call 0412 345 678",
      "Call 0412345678",
      "Call +61 412 345 678",
      "Call +61412345678",
    ];
    for (const c of cases) {
      const { text, stats } = redactPii(c);
      expect(text).toContain("[REDACTED-PHONE]");
      expect(stats.phones).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not redact 4-digit years or short numeric tokens", () => {
    const { text, stats } = redactPii(
      "Joined Acme in 2019, 6 years experience, version 1.2.3 ships in Q4 2024."
    );
    expect(text).not.toContain("[REDACTED-PHONE]");
    expect(stats.phones).toBe(0);
  });

  it("does not redact code-like content (port numbers, IPs)", () => {
    const { text, stats } = redactPii(
      "Server listens on 192.168.1.1:8080 with port 3000 in dev."
    );
    expect(stats.phones).toBe(0);
    expect(text).toContain("192.168.1.1");
  });

  it("redacts AU street addresses", () => {
    const { text, stats } = redactPii(
      "Office at 42 Eagle Street Brisbane, also visit 7B Smith Road"
    );
    expect(text).toContain("[REDACTED-ADDRESS]");
    expect(stats.addresses).toBeGreaterThanOrEqual(2);
  });

  it("redacts AU postcodes (keeps state)", () => {
    const { text, stats } = redactPii("Brisbane QLD 4000 is the city.");
    expect(text).toContain("QLD [REDACTED]");
    expect(text).not.toContain("4000");
    expect(stats.addresses).toBe(1);
  });

  it("leaves text without PII unchanged", () => {
    const input =
      "Senior engineer working on AI platforms with Terraform and Azure Container Apps.";
    const { text, stats } = redactPii(input);
    expect(text).toBe(input);
    expect(stats).toEqual({ emails: 0, phones: 0, addresses: 0 });
  });

  it("aggregates stats across multiple matches", () => {
    const { stats } = redactPii(
      "alex@a.com, bob@b.com, +61412345678, 13 Main Street, NSW 2000"
    );
    expect(stats.emails).toBe(2);
    expect(stats.phones).toBe(1);
    expect(stats.addresses).toBe(2);
  });
});
