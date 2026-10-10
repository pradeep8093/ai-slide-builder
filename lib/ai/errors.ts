export type AiErrorCode =
  | "missing_api_key"
  | "invalid_request"
  | "payload_too_large"
  | "auth_failed"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "invalid_output"
  | "output_truncated"
  | "upstream_error"
  | "network_error"
  | "server_unreachable"
  | "aborted";

export interface AiErrorBody {
  error: { code: AiErrorCode; message: string; retryAfterSeconds?: number };
}

export class AiRequestError extends Error {
  readonly code: AiErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: AiErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AiRequestError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AiErrorDetails {
  retryAfterSeconds?: number;
  status?: number;
  providerMessage?: string;
  /** Extra guidance, e.g. when the key clearly belongs to a different provider than LLM_BASE_URL. */
  hint?: string;
}

function providerSuffix(details?: AiErrorDetails): string {
  return details?.providerMessage ? ` The provider said: “${details.providerMessage.slice(0, 200)}”` : "";
}

export function aiErrorMessage(code: AiErrorCode, details?: AiErrorDetails): string {
  switch (code) {
    case "missing_api_key":
      return "The AI assistant isn't configured yet. Add LLM_API_KEY to .env.local and restart the dev server.";
    case "invalid_request":
      return "The request to the AI assistant was invalid.";
    case "payload_too_large":
      return "This deck is too large to send to the AI assistant.";
    case "auth_failed":
      return `The AI provider rejected the API key. ${details?.hint ?? "Check LLM_API_KEY in .env.local."}${providerSuffix(details)}`;
    case "forbidden":
      return `The AI provider refused the request (403). Check that this API key is allowed to use the model in LLM_MODEL and that the account is active.${providerSuffix(details)}`;
    case "rate_limited":
      return details?.retryAfterSeconds
        ? `The AI service is busy (rate limit). Try again in ${details.retryAfterSeconds} seconds.`
        : "The AI service is busy (rate limit). Try again in a moment.";
    case "timeout":
      return "The AI took too long to respond. Try a smaller request.";
    case "invalid_output":
      return "The AI returned a response the editor couldn't use. Please try again.";
    case "output_truncated":
      return "The AI's answer was too long and got cut off. Try asking for fewer slides at a time.";
    case "upstream_error": {
      const status = details?.status ? ` (${details.status})` : "";
      const provider = details?.providerMessage ? `: ${details.providerMessage.slice(0, 200)}` : ".";
      return `The AI service returned an error${status}${provider}`;
    }
    case "network_error":
      return "Couldn't reach the AI service. Check your internet connection and LLM_BASE_URL.";
    case "server_unreachable":
      return "Couldn't reach the app server. Make sure it's still running.";
    case "aborted":
      return "Stopped.";
  }
}
