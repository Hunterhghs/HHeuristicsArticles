export interface Env {
  AI: any;
  ARTICLES: KVNamespace;
}

const SITE_TITLE = "HHeuristics Daily Insights";

// Core topics aligned with your brand; the model will vary within these.
const TOPIC_BUCKETS = [
  "emerging technologies and their strategic implications for executives",
  "cloud infrastructure, cost optimization, and FinOps best practices",
  "financial technology disruption and embedded finance models",
  "energy transition, grid modernization, and decarbonization pathways",
  "industrial automation, robotics, and supply chain resilience",
  "AI and analytics in enterprise decision-making and business intelligence",
  "global regulatory shifts impacting technology and financial services",
  "consumer spending trends and macroeconomic signals",
];

function pickTopicForToday(date: Date): string {
  const dayIndex = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  const idx = dayIndex % TOPIC_BUCKETS.length;
  return TOPIC_BUCKETS[idx];
}

export default {
  /**
   * HTTP handler – serves the latest article as a simple webpage.
   * - GET /          → latest article
   * - GET /archive   → JSON list of article metadata
   * - GET /article/YYYY-MM-DD → specific article
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/archive") {
      return listArchive(env);
    }

    if (path.startsWith("/article/")) {
      const date = path.replace("/article/", "");
      return renderArticleByDate(env, date);
    }

    // Default: render latest article
    return renderLatestArticle(env);
  },

  /**
   * Cron handler – generates a new article once per day.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(generateDailyArticle(env));
  },
} satisfies ExportedHandler<Env>;

type StoredArticle = {
  key: string;
  title: string;
  bodyHtml: string;
  date: string; // YYYY-MM-DD
  topic: string;
};

async function renderLatestArticle(env: Env): Promise<Response> {
  if (!env.ARTICLES) {
    return new Response(
      "Storage is not configured yet (KV binding 'ARTICLES' is missing). Please add a KV binding named ARTICLES in the Cloudflare dashboard.",
      { status: 500 }
    );
  }
  let latestKey = await env.ARTICLES.get("latest-key");
  if (!latestKey) {
    // If no article exists yet but bindings are configured, generate one immediately.
    if (env.AI) {
      await generateDailyArticle(env);
      latestKey = await env.ARTICLES.get("latest-key");
    }

    if (!latestKey) {
      return new Response(
        "No article generated yet. The first daily article will appear after the next scheduled run.",
        { status: 503 }
      );
    }
  }
  return renderArticleByKey(env, latestKey);
}

async function renderArticleByDate(env: Env, date: string): Promise<Response> {
  if (!env.ARTICLES) {
    return new Response(
      "Storage is not configured yet (KV binding 'ARTICLES' is missing). Please add a KV binding named ARTICLES in the Cloudflare dashboard.",
      { status: 500 }
    );
  }
  const key = `article:${date}`;
  const exists = await env.ARTICLES.get(key);
  if (!exists) {
    return new Response("Article not found for that date.", { status: 404 });
  }
  return renderArticleByKey(env, key);
}

async function renderArticleByKey(env: Env, key: string): Promise<Response> {
  if (!env.ARTICLES) {
    return new Response(
      "Storage is not configured yet (KV binding 'ARTICLES' is missing). Please add a KV binding named ARTICLES in the Cloudflare dashboard.",
      { status: 500 }
    );
  }
  const stored = await env.ARTICLES.get<StoredArticle>(key, "json");
  if (!stored) {
    return new Response("Article missing.", { status: 500 });
  }

  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(stored.title)} – ${SITE_TITLE}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Daily executive insight from HHeuristics on ${escapeHtml(
      stored.topic
    )}." />
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        max-width: 760px;
        margin: 2.5rem auto;
        padding: 0 1.25rem 3rem;
        line-height: 1.7;
        background: radial-gradient(circle at top, #111827, #020617 55%);
        color: #e5e7eb;
      }
      header {
        margin-bottom: 2.5rem;
      }
      .site-title {
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        opacity: 0.75;
      }
      h1 {
        font-size: 2.4rem;
        margin: 0.6rem 0 0.25rem;
        color: #f9fafb;
      }
      .meta {
        font-size: 0.9rem;
        opacity: 0.8;
      }
      main h2 {
        font-size: 1.4rem;
        margin-top: 2rem;
        color: #e5e7eb;
      }
      main p {
        margin: 0.9rem 0;
      }
      main ul {
        padding-left: 1.5rem;
      }
      main li {
        margin: 0.4rem 0;
      }
      a {
        color: #93c5fd;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      footer {
        margin-top: 3rem;
        font-size: 0.85rem;
        opacity: 0.7;
      }
      .nav {
        display: flex;
        gap: 1rem;
        margin-top: 0.5rem;
      }
    </style>
  </head>
  <body>
    <header>
      <div class="site-title">${SITE_TITLE}</div>
      <h1>${escapeHtml(stored.title)}</h1>
      <div class="meta">
        ${stored.date} · Topic: ${escapeHtml(stored.topic)}
      </div>
      <div class="nav">
        <a href="/">Latest</a>
        <a href="/archive">Archive (JSON)</a>
        <a href="https://hheuristics.com">HHeuristics.com</a>
      </div>
    </header>
    <main>
      ${stored.bodyHtml}
    </main>
    <footer>
      Generated daily using Cloudflare Workers AI. Content for informational purposes only and does not constitute investment or legal advice.
    </footer>
  </body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function listArchive(env: Env): Promise<Response> {
  if (!env.ARTICLES) {
    return new Response(
      JSON.stringify({
        error:
          "Storage is not configured yet (KV binding 'ARTICLES' is missing). Please add a KV binding named ARTICLES in the Cloudflare dashboard.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
  const list = await env.ARTICLES.list({ prefix: "article:" });
  const items: Array<{ date: string; title: string; topic: string }> = [];

  for (const key of list.keys) {
    const stored = await env.ARTICLES.get<StoredArticle>(key.name, "json");
    if (stored) {
      items.push({ date: stored.date, title: stored.title, topic: stored.topic });
    }
  }

  // Sort newest first
  items.sort((a, b) => (a.date < b.date ? 1 : -1));

  return new Response(JSON.stringify(items, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function generateDailyArticle(env: Env) {
  // If KV or AI bindings are not present yet, skip generation gracefully.
  if (!env.ARTICLES || !env.AI) {
    return;
  }
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `article:${today}`;

  const existing = await env.ARTICLES.get(key);
  if (existing) {
    return;
  }

  const topic = pickTopicForToday(now);

  const systemPrompt = `
You are an HHeuristics research writer.
Audience: senior executives, investors, and policymakers.
Tone: analytical, concise, evidence-informed, and non-sensational.
Style: clear headings, short paragraphs, and concrete takeaways.
Perspective: neutral, with explicit distinctions between facts, signals, and interpretation.
`;

  const userPrompt = `
Write an approximately 1,200-word article for an executive audience on:
"${topic}".

Structure:
- A strong, descriptive title at the top.
- A 2–3 paragraph introduction.
- 3–5 subsections with <h2> headings that cover:
  - current landscape
  - key risks and opportunities
  - practical frameworks or decision heuristics
- A closing section with 3–5 bullet-point recommendations.

Output:
- Valid HTML fragment containing only <h1>, <h2>, <p>, <ul>, <ol>, and <li> tags.
- Do NOT include <html>, <head>, or <body> tags.
`;

  const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 1800,
  } as any);

  const raw = String(response.response ?? "");
  const firstLine = raw.split("\n").find((l) => l.trim().length > 0) ?? "Daily Insight";
  const title = firstLine.replace(/<[^>]*>/g, "").trim();

  const article: StoredArticle = {
    key,
    title: title || `Daily Insight – ${today}`,
    bodyHtml: raw,
    date: today,
    topic,
  };

  await env.ARTICLES.put(key, JSON.stringify(article));
  await env.ARTICLES.put("latest-key", key);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


