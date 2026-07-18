export interface Health {
  status: string;
  version: string;
  time: string;
}

export async function fetchHealth(baseUrl: string): Promise<Health> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return (await res.json()) as Health;
}
