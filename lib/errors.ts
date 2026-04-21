export async function parseApiError(response: Response) {
  const fallback = `Request failed with status ${response.status}`;
  let payload: { error?: string } | null = null;

  try {
    payload = (await response.json()) as { error?: string };
  } catch {}

  throw new Error(payload?.error || fallback);
}
