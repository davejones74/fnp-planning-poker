export interface Me {
  authenticated: boolean;
  isAdmin: boolean;
  identity: { displayName: string } | null;
}

export async function me(): Promise<Me> {
  const res = await fetch("/api/me", { headers: { "content-type": "application/json" } });
  const body = (await res.json()) as Me;
  return body;
}