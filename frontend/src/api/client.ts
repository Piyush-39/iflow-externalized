export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers }
    });
  } catch {
    throw new ApiError("Cannot reach the backend. Confirm that the API server is running.", 0);
  }
  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!response.ok) {
    const error = payload?.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : undefined;
    throw new ApiError(
      typeof error?.message === "string" ? error.message : friendlyStatus(response.status),
      response.status,
      error
    );
  }
  return payload as T;
}

function friendlyStatus(status: number): string {
  if (status === 401) return "SAP authentication failed.";
  if (status === 403) return "You are not authorized to perform this SAP operation.";
  if (status === 404) return "The requested iFlow was not found.";
  if (status === 409) return "The iFlow changed in SAP. Analyze it again before retrying.";
  if (status === 422) return "The artifact failed validation.";
  if (status === 504) return "The SAP request timed out.";
  return "The request could not be completed.";
}
