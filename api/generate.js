// api/generate.js

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const GLOBAL_WEEKLY_LIMIT = 1000;
const IP_WEEKLY_LIMIT = 10;

function getWeekKeySuffix(date = new Date()) {
  // ISO week "bucket" (jednoduché: YYYY-WW podľa UTC)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const year = d.getUTCFullYear();
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  const xri = req.headers["x-real-ip"];
  if (typeof xri === "string" && xri.length > 0) return xri.trim();
  // fallback
  return "unknown";
}

async function upstash(cmd, args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing Upstash env vars");

  const res = await fetch(`${url}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Upstash error (${res.status})`);
  return json;
}

async function incrWithExpire(key, ttlSeconds) {
  // INCR + EXPIRE (ak ešte nemá TTL)
  const incr = await upstash("INCR", [key]);
  // nastav TTL zakaždým (jednoduché a OK pre naše limity)
  await upstash("EXPIRE", [key, String(ttlSeconds)]);
  return incr?.result ?? 0;
}

export default async function handler(req, res) {
  // CORS (ak budeš volať z webu)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "Missing prompt" }));
    }

    // ---- Rate limiting (weekly) ----
    const week = getWeekKeySuffix();
    const ip = getClientIp(req);

    const globalKey = `rate:global:${week}`;
    const ipKey = `rate:ip:${ip}:${week}`;

    const [globalCount, ipCount] = await Promise.all([
      incrWithExpire(globalKey, WEEK_SECONDS),
      incrWithExpire(ipKey, WEEK_SECONDS),
    ]);

    if (ipCount > IP_WEEKLY_LIMIT) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "IP weekly limit reached", limit: IP_WEEKLY_LIMIT }));
    }

    if (globalCount > GLOBAL_WEEKLY_LIMIT) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "Weekly global limit reached", limit: GLOBAL_WEEKLY_LIMIT }));
    }

    // ---- OpenAI Images API ----
    const openaiRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1.5",     // ak nebude fungovať, zmeň na "gpt-image-1"
        prompt,
        size: "1536x1024",
        response_format: "b64_json"
      }),
    });

    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      res.statusCode = openaiRes.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: data?.error || data }));
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "No image returned from OpenAI" }));
    }

    const imgBuffer = Buffer.from(b64, "base64");

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.end(imgBuffer);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
}
