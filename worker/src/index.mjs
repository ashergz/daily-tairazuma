import {
  buildArchive,
  fetchRedditPosts,
  serializeArchive
} from "../../scripts/archive-core.mjs";

const DEFAULT_REPO = "ashergz/daily-tairazuma";
const DEFAULT_BRANCH = "main";
const GITHUB_API = "https://api.github.com";
const WORKER_USER_AGENT = "daily-tairazuma-sync/1.0";

function githubHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured");

  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": WORKER_USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function githubContentUrl(env, includeRef) {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const branch = env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const base = `${GITHUB_API}/repos/${repo}/contents/cubari.json`;
  return includeRef ? `${base}?ref=${encodeURIComponent(branch)}` : base;
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function parseGitHubResponse(response, operation) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep the status-based error below useful even for an invalid response body.
  }

  if (!response.ok) {
    const detail = payload?.message ? `: ${payload.message}` : "";
    throw new Error(`GitHub ${operation} failed: HTTP ${response.status}${detail}`);
  }

  return payload;
}

async function readGithubArchive(env, fetchImpl) {
  const response = await fetchImpl(githubContentUrl(env, true), {
    headers: githubHeaders(env)
  });
  const payload = await parseGitHubResponse(response, "archive read");
  const serialized = decodeBase64Utf8(payload.content);
  return {
    archive: JSON.parse(serialized),
    serialized,
    sha: payload.sha
  };
}

async function writeGithubArchive(env, fetchImpl, serialized, sha) {
  const branch = env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const response = await fetchImpl(githubContentUrl(env, false), {
    method: "PUT",
    headers: {
      ...githubHeaders(env),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "Sync Reddit archive",
      content: encodeBase64Utf8(serialized),
      sha,
      branch
    })
  });
  return parseGitHubResponse(response, "archive write");
}

export async function syncGitHubArchive(env, fetchImpl = fetch) {
  const posts = await fetchRedditPosts(fetchImpl, {
    clientId: env.REDDIT_CLIENT_ID,
    clientSecret: env.REDDIT_CLIENT_SECRET,
    userAgent: env.REDDIT_USER_AGENT
  });
  const current = await readGithubArchive(env, fetchImpl);
  const archive = buildArchive(posts, current.archive);
  const serialized = serializeArchive(archive);

  if (serialized === current.serialized) {
    return {
      changed: false,
      posts: posts.length,
      chapterCount: Object.keys(archive.chapters).length
    };
  }

  await writeGithubArchive(env, fetchImpl, serialized, current.sha);
  return {
    changed: true,
    posts: posts.length,
    chapterCount: Object.keys(archive.chapters).length
  };
}

export default {
  async fetch(request) {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ ok: true, service: "daily-tairazuma-sync" });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env) {
    try {
      const result = await syncGitHubArchive(env);
      console.log(JSON.stringify({
        event: "archive-sync",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        ...result
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "archive-sync-failed",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }));
      throw error;
    }
  }
};
