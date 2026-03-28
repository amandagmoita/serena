// ─── MINI CLIENTE REDIS (UPSTASH REST API) ───────────────
// Compatível com qualquer nome de variável do Upstash/Vercel KV
// ──────────────────────────────────────────────────────────

export async function redisCommand(...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL
    || process.env.KV_REST_API_URL
    || process.env.KV_URL
    || process.env.REDIS_URL;

  const token = process.env.UPSTASH_REDIS_REST_TOKEN
    || process.env.KV_REST_API_TOKEN
    || process.env.KV_REST_API_READ_ONLY_TOKEN;

  if (!url || !token) {
    throw new Error('Redis não configurado — variáveis de ambiente não encontradas');
  }

  const res = await fetch(url, {
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
