type ErrorWithStatus = {
  status?: number;
  message?: string;
  error?: {
    message?: string;
  };
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
      };
    };
  };
};

const RATE_LIMIT_MESSAGE =
  "Groq rate limit reached. Please wait a moment and try again.";

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as ErrorWithStatus;
  return candidate.status ?? candidate.response?.status;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const candidate = error as ErrorWithStatus;
  return (
    candidate.response?.data?.error?.message ||
    candidate.error?.message ||
    candidate.message ||
    fallback
  );
}

export function buildApiErrorResponse(
  error: unknown,
  fallbackMessage: string,
) {
  const status = getErrorStatus(error) ?? 500;
  const message =
    status === 429
      ? RATE_LIMIT_MESSAGE
      : getErrorMessage(error, fallbackMessage);

  return { status, message };
}
