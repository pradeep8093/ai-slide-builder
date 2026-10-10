import { describe, expect, it } from "vitest";
import { aiErrorMessage, AiRequestError, type AiErrorCode } from "./errors";

const CODES: AiErrorCode[] = [
  "missing_api_key", "invalid_request", "payload_too_large", "auth_failed", "forbidden", "rate_limited", "timeout",
  "invalid_output", "output_truncated", "upstream_error", "network_error", "server_unreachable", "aborted",
];

describe("AI errors", () => {
  it.each(CODES)("has a user-facing message for %s", (code) => {
    expect(aiErrorMessage(code).length).toBeGreaterThan(5);
  });

  it("mentions the env variable when the key is missing", () => {
    expect(aiErrorMessage("missing_api_key")).toContain("LLM_API_KEY");
  });

  it("includes retry timing and provider details when known", () => {
    expect(aiErrorMessage("rate_limited", { retryAfterSeconds: 12 })).toContain("12 seconds");
    expect(aiErrorMessage("upstream_error", { status: 400, providerMessage: "model not found" })).toBe(
      "The AI service returned an error (400): model not found",
    );
    expect(aiErrorMessage("upstream_error", { providerMessage: "x".repeat(500) }).length).toBeLessThan(260);
  });

  it("uses a hint instead of the generic advice when one is given", () => {
    expect(aiErrorMessage("auth_failed", { hint: "Wrong provider." })).toBe("The AI provider rejected the API key. Wrong provider.");
    expect(aiErrorMessage("forbidden")).toContain("(403)");
  });

  it("carries the code on the error object", () => {
    const err = new AiRequestError("timeout", "slow", 3);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "timeout", message: "slow", retryAfterSeconds: 3, name: "AiRequestError" });
  });
});
