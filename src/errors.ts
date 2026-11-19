export type NowPaymentsErrorType =
  | "CONFIGURATION"
  | "VALIDATION"
  | "NETWORK"
  | "TIMEOUT"
  | "API"
  | "UNKNOWN";

export interface NowPaymentsErrorInit {
  type?: NowPaymentsErrorType;
  code?: string;
  message?: string;
  httpStatus?: number;
  requestId?: string;
  details?: unknown;
  cause?: unknown;
}

/** Structured error for every SDK failure path. */
export class NowPaymentsError extends Error {
  readonly type: NowPaymentsErrorType;
  readonly code: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(init: NowPaymentsErrorInit = {}) {
    super(init.message ?? "NOWPayments request failed");
    this.name = "NowPaymentsError";
    this.type = init.type ?? "UNKNOWN";
    this.code = init.code ?? "UNKNOWN";
    if (init.httpStatus !== undefined) this.httpStatus = init.httpStatus;
    if (init.requestId !== undefined) this.requestId = init.requestId;
    if (init.details !== undefined) this.details = init.details;
    if (init.cause !== undefined) this.cause = init.cause;
  }

  /** Build an error from an HTTP response body (APIError with status). */
  static fromResponse(
    httpStatus: number,
    body: unknown,
    fallbackMessage?: string,
  ): NowPaymentsError {
    let message = fallbackMessage ?? `NOWPayments API request failed with status ${httpStatus}`;
    let code = "API_ERROR";
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (typeof b.message === "string" && b.message.trim()) message = b.message;
      else if (typeof b.error === "string" && b.error.trim()) message = b.error;
      if (typeof b.code === "string") code = b.code;
    } else if (typeof body === "string" && body.trim() && body.length < 300) {
      message = body;
    }
    return new NowPaymentsError({ type: "API", code, message, httpStatus, details: body });
  }
}

/** True when the value is a NowPaymentsError (works across package copies). */
export function isNowPaymentsError(error: unknown): error is NowPaymentsError {
  return error instanceof Error && error.name === "NowPaymentsError";
}
