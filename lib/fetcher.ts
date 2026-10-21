export async function fetcher<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    const error = new Error(
      `Request failed with status ${response.status}`
    ) as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}
