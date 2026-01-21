export type CoalescedKey = string;

export type SerializableResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type CacheEntry = {
  expiresAt: number;
  body: unknown;
  headers: Record<string, string>;
  status: number;
  // For stale-while-revalidate demo
  persistedAt: number;
};
