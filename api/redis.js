// ─── MINI CLIENTE REDIS (UPSTASH REST API) ───────────────
// Funciona sem npm install — usa fetch direto
// Env vars: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// ──────────────────────────────────────────────────────────

export async function redisCommand(...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function redisGet(key) {
  const raw = await redisCommand('GET', key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function redisSet(key, value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return await redisCommand('SET', key, json);
}

export async function redisDel(key) {
  return await redisCommand('DEL', key);
}
