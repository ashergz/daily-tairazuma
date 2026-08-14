export const SEARCH_ENDPOINT = "https://www.reddit.com/r/Seihantai/search.json";
export const OAUTH_TOKEN_ENDPOINT = "https://www.reddit.com/api/v1/access_token";
export const OAUTH_SEARCH_ENDPOINT = "https://oauth.reddit.com/r/Seihantai/search";
export const COVER_URL = "https://daily-tairazuma.pages.dev/cover2.jpg";
export const SEARCH_PARAMS = {
  q: "author:dark074",
  include_over_18: "on",
  restrict_sr: "on",
  t: "all",
  sort: "new",
  type: "link",
  limit: "100",
  raw_json: "1"
};

const REDDIT_IMAGE_HOSTS = new Set([
  "i.redd.it",
  "preview.redd.it",
  "external-preview.redd.it"
]);

const DEFAULT_USER_AGENT = "web:daily-tairazuma:1.0 (archive reader)";

function resolveUserAgent(userAgent) {
  return userAgent || DEFAULT_USER_AGENT;
}

function decodeEntities(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function asTimestamp(post) {
  const edited = Number(post.edited);
  const created = Number(post.created_utc);
  return Number.isFinite(edited) && edited > 0
    ? Math.floor(edited)
    : Number.isFinite(created)
      ? Math.floor(created)
      : 0;
}

function cleanUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return decodeEntities(value).trim();
}

function isRedditImageUrl(value) {
  const url = cleanUrl(value);
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!REDDIT_IMAGE_HOSTS.has(host)) return false;

    return /\.(?:jpe?g|png|gif|webp|avif)(?:$|[?#])/i.test(parsed.pathname)
      || host === "i.redd.it";
  } catch {
    return false;
  }
}

export function directImageUrl(post) {
  const candidates = [
    post.url_overridden_by_dest,
    post.url
  ];

  if (post.post_hint === "image") {
    candidates.push(post.preview?.images?.[0]?.source?.url);
  }

  for (const candidate of candidates) {
    if (isRedditImageUrl(candidate)) return cleanUrl(candidate);
  }

  return null;
}

export function classifyPost(post) {
  const id = typeof post?.id === "string" ? post.id.trim() : "";
  if (!id) return null;

  if (post.is_gallery === true
    && Array.isArray(post.gallery_data?.items)
    && post.gallery_data.items.length > 0) {
    return {
      id,
      title: post.title || id,
      createdUtc: asTimestamp(post),
      group: `/proxy/api/reddit/chapter/${id}/`,
      type: "gallery"
    };
  }

  const image = directImageUrl(post);
  if (image) {
    return {
      id,
      title: post.title || id,
      createdUtc: asTimestamp(post),
      group: [image],
      type: "image"
    };
  }

  return null;
}

function xmlTag(block, tag) {
  return block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))?.[1] || null;
}

export function parseRedditRss(xml) {
  const entries = [...String(xml).matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(match => decodeEntities(match[0]));
  const posts = [];

  for (const entry of entries) {
    const rawId = xmlTag(entry, "id") || entry.match(/\/comments\/([a-z0-9]+)/i)?.[1] || "";
    const id = rawId.match(/\/comments\/([a-z0-9]+)/i)?.[1]
      || rawId.match(/t3_([a-z0-9]+)/i)?.[1]
      || rawId.match(/^([a-z0-9]+)$/i)?.[1];
    if (!id) continue;

    const title = (xmlTag(entry, "title") || id).trim();
    const published = Date.parse(xmlTag(entry, "updated") || xmlTag(entry, "published") || "");
    const createdUtc = Number.isFinite(published) ? Math.floor(published / 1000) : 0;
    const urls = [
      ...[...entry.matchAll(/(?:href|url)=["']([^"']+)["']/gi)].map(match => match[1]),
      ...entry.match(/https?:\/\/[^"'<>\s]+/gi) || []
    ].map(cleanUrl).filter(Boolean);
    const image = urls.find(url => {
      if (!isRedditImageUrl(url)) return false;
      try {
        return new URL(url).hostname.toLowerCase() !== "external-preview.redd.it";
      } catch {
        return false;
      }
    });
    const isGallery = urls.some(url => /\/gallery\/[a-z0-9]+/i.test(url));

    if (isGallery) {
      posts.push({
        id,
        title,
        created_utc: createdUtc,
        is_gallery: true,
        gallery_data: { items: [{}] }
      });
    } else if (image) {
      posts.push({ id, title, created_utc: createdUtc, url: image });
    } else {
      posts.push({ id, title, created_utc: createdUtc });
    }
  }

  return posts;
}

async function fetchRedditListingPosts(fetchImpl, endpoint, headers) {
  const posts = new Map();
  const seenCursors = new Set();
  let after = null;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams(SEARCH_PARAMS);
    if (after) params.set("after", after);
    const response = await fetchImpl(`${endpoint}?${params}`, { headers });

    if (!response.ok) {
      throw new Error(`Reddit search failed: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const listing = payload?.data;
    if (!listing || !Array.isArray(listing.children)) {
      throw new Error("Reddit search returned an unexpected response");
    }

    for (const child of listing.children) {
      const post = child?.data;
      if (post?.id) posts.set(post.id, post);
    }

    const next = listing.after || null;
    if (!next || next === after || seenCursors.has(next)) return [...posts.values()];
    seenCursors.add(next);
    after = next;
  }

  throw new Error("Reddit search exceeded the pagination safety limit");
}

async function fetchRedditJsonPosts(fetchImpl, userAgent) {
  return fetchRedditListingPosts(fetchImpl, SEARCH_ENDPOINT, {
    Accept: "application/json",
    "User-Agent": resolveUserAgent(userAgent)
  });
}

function basicAuth(clientId, clientSecret) {
  return btoa(`${clientId}:${clientSecret}`);
}

export async function fetchRedditOAuthPosts(fetchImpl = fetch, {
  clientId = null,
  clientSecret = null,
  userAgent = null
} = {}) {
  if (!clientId || !clientSecret) return null;

  const tokenResponse = await fetchImpl(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": resolveUserAgent(userAgent)
    },
    body: "grant_type=client_credentials"
  });
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenPayload?.access_token) {
    throw new Error(`Reddit OAuth token failed: HTTP ${tokenResponse.status}`);
  }

  return fetchRedditListingPosts(fetchImpl, OAUTH_SEARCH_ENDPOINT, {
    Accept: "application/json",
    Authorization: `bearer ${tokenPayload.access_token}`,
    "User-Agent": resolveUserAgent(userAgent)
  });
}

export async function fetchRedditRss(fetchImpl = fetch, { userAgent = null } = {}) {
  const params = new URLSearchParams(SEARCH_PARAMS);
  params.delete("raw_json");
  const url = `https://www.reddit.com/r/Seihantai/search.rss?${params}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, text/xml",
      "User-Agent": resolveUserAgent(userAgent)
    }
  });

  if (!response.ok) {
    throw new Error(`Reddit RSS failed: HTTP ${response.status}`);
  }

  const posts = parseRedditRss(await response.text());
  if (posts.length === 0) throw new Error("Reddit RSS returned no posts");
  return posts;
}

export async function fetchRedditPosts(fetchImpl = fetch, {
  clientId = null,
  clientSecret = null,
  userAgent = null
} = {}) {
  let oauthError = null;

  if (clientId && clientSecret) {
    try {
      return await fetchRedditOAuthPosts(fetchImpl, { clientId, clientSecret, userAgent });
    } catch (error) {
      oauthError = error;
      console.warn(`Reddit OAuth unavailable; trying public JSON (${error.message})`);
    }
  }

  try {
    return await fetchRedditJsonPosts(fetchImpl, userAgent);
  } catch (jsonError) {
    try {
      const reason = oauthError ? `${oauthError.message}; ${jsonError.message}` : jsonError.message;
      console.warn(`Reddit JSON unavailable; using RSS fallback (${reason})`);
      return await fetchRedditRss(fetchImpl, { userAgent });
    } catch (rssError) {
      const reason = oauthError ? `${oauthError.message}; ${jsonError.message}` : jsonError.message;
      throw new Error(`${reason}; RSS fallback failed: ${rssError.message}`);
    }
  }
}

function existingRedditId(chapter) {
  if (typeof chapter?.reddit_id === "string" && chapter.reddit_id) {
    return chapter.reddit_id;
  }

  const group = chapter?.groups?.Reddit;
  if (typeof group !== "string") return null;
  return group.match(/\/proxy\/api\/reddit\/chapter\/([a-z0-9]+)\/?$/i)?.[1] || null;
}

function numericChapterSort([left], [right]) {
  const a = Number(left);
  const b = Number(right);
  const aNumeric = Number.isFinite(a);
  const bNumeric = Number.isFinite(b);
  if (aNumeric && bNumeric) return a - b;
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return left.localeCompare(right);
}

export function buildArchive(posts, existing = null) {
  const archive = {
    title: "Daily Tairazuma",
    description: "Gallery archive for u/Dark074 in r/Seihantai.",
    author: "u/Dark074",
    artist: "@pt_zm69, @puri_8x4, @mod987651, @allegro365sui, @harutk17, @konbutuyutuyu, @curuc_, and more",
    cover: COVER_URL,
    chapters: {}
  };

  const previousChapters = existing?.chapters && typeof existing.chapters === "object"
    ? existing.chapters
    : {};
  const chapterByRedditId = new Map();
  let nextChapter = 0;

  for (const [key, chapter] of Object.entries(previousChapters).sort(numericChapterSort)) {
    archive.chapters[key] = chapter;
    const numericKey = Number(key);
    if (Number.isFinite(numericKey)) nextChapter = Math.max(nextChapter, numericKey);

    const redditId = existingRedditId(chapter);
    if (redditId && !chapterByRedditId.has(redditId)) {
      chapterByRedditId.set(redditId, key);
    }
  }

  const candidates = posts
    .map(classifyPost)
    .filter(Boolean)
    .sort((left, right) => left.createdUtc - right.createdUtc || left.id.localeCompare(right.id));

  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  const sourceIds = new Set(posts.map(post => post?.id).filter(Boolean));
  for (const [key, chapter] of Object.entries(archive.chapters)) {
    const redditId = existingRedditId(chapter);
    if (redditId && sourceIds.has(redditId) && !candidateIds.has(redditId)) {
      delete archive.chapters[key];
    }
  }

  for (const candidate of candidates) {
    let chapterKey = chapterByRedditId.get(candidate.id);
    if (!chapterKey) {
      do {
        nextChapter += 1;
        chapterKey = String(nextChapter);
      } while (archive.chapters[chapterKey]);
      chapterByRedditId.set(candidate.id, chapterKey);
    }

    const previous = archive.chapters[chapterKey] || {};
    archive.chapters[chapterKey] = {
      ...previous,
      title: candidate.title,
      groups: { Reddit: candidate.group },
      last_updated: candidate.createdUtc,
      reddit_id: candidate.id
    };
  }

  archive.chapters = Object.fromEntries(Object.entries(archive.chapters).sort(numericChapterSort));
  return archive;
}

export function serializeArchive(archive) {
  return `${JSON.stringify(archive, null, 2)}\n`;
}
