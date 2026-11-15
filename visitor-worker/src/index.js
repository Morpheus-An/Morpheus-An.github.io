// Visitor map backend for morpheus-an.github.io.
//
//   POST /collect?ref=&p=   record one visit (location comes from Cloudflare's request.cf)
//   GET  /points            public: visit counts per city, for the globe
//   GET  /stats             public: totals by country, referrer and browser
//   GET  /log               owner only (Authorization: Bearer <OWNER_KEY>): recent visits with IPs

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|httpclient|axios|go-http|java\//i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      switch (url.pathname) {
        case "/collect":
          return await collect(request, env, url, allowed, cors);
        case "/points":
          return json(await points(env), cors, 120);
        case "/stats":
          return json(await stats(env), cors, 120);
        case "/log":
          return await log(request, env, url, cors);
        default:
          return json({ error: "not found" }, cors, 0, 404);
      }
    } catch (e) {
      console.error(e);
      return json({ error: "server error" }, cors, 0, 500);
    }
  },
};

function json(body, cors, maxAge = 0, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

function browserOf(ua) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

async function collect(request, env, url, allowed, cors) {
  // Only count visits made from the site itself (Origin for fetch, Referer as a fallback)
  const from = request.headers.get("Origin") || request.headers.get("Referer") || "";
  if (!allowed.some((o) => from === o || from.startsWith(o + "/"))) {
    return json({ ok: false }, cors, 0, 403);
  }
  const ua = request.headers.get("User-Agent") || "";
  if (!ua || BOT_UA.test(ua)) return json({ ok: true, skipped: "bot" }, cors);

  const cf = request.cf || {};
  const lat = Number(cf.latitude);
  const lon = Number(cf.longitude);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lon);
  const country = cf.country || "";
  const city = cf.city || "";
  const ref = hostOf(url.searchParams.get("ref") || "") || "direct";
  const path = (url.searchParams.get("p") || "").slice(0, 200);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const org = cf.asOrganization || "";

  const tally = env.DB.prepare(
    "INSERT INTO tallies (kind, key, count) VALUES (?, ?, 1) ON CONFLICT(kind, key) DO UPDATE SET count = count + 1",
  );
  const stmts = [
    env.DB.prepare(
      "INSERT INTO visits (ts, ip, city, region, country, lat, lon, org, ref, path, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(new Date().toISOString(), ip, city, cf.region || "", country, hasGeo ? lat : null, hasGeo ? lon : null, org, ref, path, ua.slice(0, 400)),
    tally.bind("total", ""),
    tally.bind("ref", ref),
    tally.bind("browser", browserOf(ua)),
  ];
  if (country) stmts.push(tally.bind("country", country));
  if (hasGeo && country) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO places (country, city, lat, lon, count) VALUES (?, ?, ?, ?, 1) ON CONFLICT(country, city) DO UPDATE SET count = count + 1",
      ).bind(country, city, Math.round(lat * 10) / 10, Math.round(lon * 10) / 10),
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true }, cors);
}

async function points(env) {
  const { results } = await env.DB.prepare("SELECT country, city, lat, lon, count FROM places ORDER BY count DESC").all();
  return results;
}

async function stats(env) {
  const { results } = await env.DB.prepare("SELECT kind, key, count FROM tallies").all();
  const out = { total: 0, countries: {}, refs: {}, browsers: {} };
  const bucket = { country: out.countries, ref: out.refs, browser: out.browsers };
  for (const r of results) {
    if (r.kind === "total") out.total = r.count;
    else if (bucket[r.kind]) bucket[r.kind][r.key] = r.count;
  }
  return out;
}

async function log(request, env, url, cors) {
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(env.OWNER_KEY || "");
  if (!b.length || a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) {
    return json({ error: "unauthorized" }, cors, 0, 401);
  }
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 1), 2000);
  const { results } = await env.DB.prepare(
    "SELECT ts, ip, city, region, country, org, ref, path, ua FROM visits ORDER BY id DESC LIMIT ?",
  ).bind(limit).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM visits").first("n");
  return json({ total, visits: results }, cors);
}
