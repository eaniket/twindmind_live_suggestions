export async function parseApiError(response: Response) {
  const fallback = `Request failed with status ${response.status}`;
  try {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error || fallback);
  } catch {
    throw new Error(fallback);
  }
}
