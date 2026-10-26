// What actually went wrong, in words a teacher can act on.
//
// The three client front doors used to collapse every failure into one line:
//
//   if (!res.ok) throw new Error(`Server responded ${res.status}`);
//
// and the catch below substituted the offline engine. So a sixty-second rate
// limit, the capacity ceiling, a model timeout, a rejected API key and a
// genuinely absent server all produced the same toast and the same silently
// thinner document. The server distinguishes these carefully — 429 with a
// Retry-After, 503 for capacity, 504 for a timeout, 502 for a bad key — and all
// of that detail was discarded one line into the client.
//
// The distinction that matters to a teacher is not the status code. It is
// whether waiting a moment and pressing the button again will work. That is
// what `recoverable` carries, and it is why a recoverable failure must NOT be
// answered with a mock draft: handing someone a permanently worse document
// instead of telling them to wait sixty seconds is a decision they would not
// have made for themselves.

export const ERROR_KINDS = {
  RATE_LIMIT: "rate-limit",
  CAPACITY: "capacity",
  TIMEOUT: "timeout",
  REFUSED: "refused",
  BAD_REQUEST: "bad-request",
  OFFLINE: "offline",
  MALFORMED: "malformed",
};

export class ApiError extends Error {
  constructor({ kind, recoverable, message, status, retryAfter }) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.recoverable = recoverable;
    this.status = status ?? null;
    // Seconds to wait, when the server told us. Used to label the retry rather
    // than to block it: a teacher may always try again immediately.
    this.retryAfter = retryAfter ?? null;
  }
}

// `offline` means no API is reachable. The generation flow lets the teacher
// explicitly choose a local draft rather than presenting it as AI-generated.
export function isOffline(err) {
  return err?.kind === ERROR_KINDS.OFFLINE;
}

const RETRY_SECONDS = (res) => {
  const raw = Number(res?.headers?.get?.("Retry-After"));
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null;
};

/**
 * Classify a non-OK response. Never throws; always returns an ApiError.
 */
export function classifyResponse(res) {
  const status = res?.status ?? 0;
  const retryAfter = RETRY_SECONDS(res);

  switch (status) {
    case 429:
      return new ApiError({
        kind: ERROR_KINDS.RATE_LIMIT,
        recoverable: true,
        status,
        retryAfter,
        message:
          "That is a lot of drafting in one minute. Wait about a minute and try again.",
      });

    case 503:
      return new ApiError({
        kind: ERROR_KINDS.CAPACITY,
        recoverable: true,
        status,
        retryAfter,
        message: "Lumen is at capacity right now. Try again in a minute.",
      });

    case 504:
      return new ApiError({
        kind: ERROR_KINDS.TIMEOUT,
        recoverable: true,
        status,
        retryAfter,
        message: "The model took too long to answer. Trying again usually works.",
      });

    case 502:
    case 500:
      // Explicitly not the teacher's fault, and explicitly not worth retrying
      // in a loop. Someone has to fix a key or a deploy.
      return new ApiError({
        kind: ERROR_KINDS.REFUSED,
        recoverable: false,
        status,
        message:
          "The drafting service refused the request. This is a setup problem on our side, not something you did.",
      });

    case 413:
      return new ApiError({
        kind: ERROR_KINDS.BAD_REQUEST,
        recoverable: false,
        status,
        message: "There is too much text in the form to send. Shorten a field and try again.",
      });

    case 400:
      return new ApiError({
        kind: ERROR_KINDS.BAD_REQUEST,
        recoverable: false,
        status,
        message: "Something in the form was missing or unusable. Check the sheet and try again.",
      });

    case 404:
      // No route: this build has no API attached.
      return new ApiError({
        kind: ERROR_KINDS.OFFLINE,
        recoverable: false,
        status,
        message:
          "The AI drafting service is not available in this build. You can connect the service or choose a local draft instead.",
      });

    default:
      return new ApiError({
        kind: ERROR_KINDS.REFUSED,
        recoverable: status >= 500,
        status,
        message: "The draft could not be generated. Try again.",
      });
  }
}

// A thrown fetch (DNS, connection refused, offline, aborted) is the same
// situation as a missing route from the teacher's point of view.
export function classifyThrown(err) {
  if (err instanceof ApiError) return err;
  return new ApiError({
    kind: ERROR_KINDS.OFFLINE,
    recoverable: false,
    status: null,
    message:
      "Lumen could not reach the AI drafting service. Check the connection or choose a local draft instead.",
  });
}

// The payload arrived but is not a document. Retrying is genuinely worth a shot
// because the model is not deterministic.
export function malformedPayload() {
  return new ApiError({
    kind: ERROR_KINDS.MALFORMED,
    recoverable: true,
    status: null,
    message: "The draft came back incomplete. Try again.",
  });
}
