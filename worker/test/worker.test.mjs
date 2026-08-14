import assert from "node:assert/strict";
import test from "node:test";
import { syncGitHubArchive } from "../src/index.mjs";

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value)
  };
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function decode(value) {
  return Buffer.from(value, "base64").toString("utf8");
}

test("synces a new Reddit chapter into GitHub and preserves the existing archive", async () => {
  const currentArchive = {
    title: "Daily Tairazuma",
    chapters: {
      "1": {
        title: "Old chapter",
        groups: { Reddit: "/proxy/api/reddit/chapter/old1/" },
        reddit_id: "old1"
      }
    }
  };
  const puts = [];

  const fetchImpl = async (url, options = {}) => {
    if (url.startsWith("https://www.reddit.com/r/Seihantai/search.json?")) {
      return jsonResponse({
        data: {
          after: null,
          children: [{
            data: {
              id: "new1",
              title: "New gallery",
              created_utc: 200,
              is_gallery: true,
              gallery_data: { items: [{}] }
            }
          }]
        }
      });
    }

    if (url === "https://api.github.com/repos/ashergz/daily-tairazuma/contents/cubari.json?ref=main") {
      return jsonResponse({
        sha: "old-sha",
        content: encode(`${JSON.stringify(currentArchive)}\n`),
        encoding: "base64"
      });
    }

    if (url === "https://api.github.com/repos/ashergz/daily-tairazuma/contents/cubari.json") {
      puts.push({ url, options });
      return jsonResponse({ content: { sha: "new-sha" } }, 200);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await syncGitHubArchive({
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO: "ashergz/daily-tairazuma",
    GITHUB_BRANCH: "main"
  }, fetchImpl);

  assert.equal(result.changed, true);
  assert.equal(result.chapterCount, 2);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].options.method, "PUT");

  const body = JSON.parse(puts[0].options.body);
  const archive = JSON.parse(decode(body.content));
  assert.equal(body.sha, "old-sha");
  assert.equal(body.branch, "main");
  assert.equal(archive.chapters["1"].reddit_id, "old1");
  assert.equal(archive.chapters["2"].reddit_id, "new1");
});

test("does not write GitHub when the generated archive is unchanged", async () => {
  const currentArchive = {
    title: "Daily Tairazuma",
    description: "Gallery archive for u/Dark074 in r/Seihantai.",
    author: "u/Dark074",
    artist: "@pt_zm69, @puri_8x4, @mod987651, @allegro365sui, @harutk17, @konbutuyutuyu, @curuc_, and more",
    cover: "https://daily-tairazuma.pages.dev/cover2.jpg",
    chapters: {
      "1": {
        title: "Existing gallery",
        groups: { Reddit: "/proxy/api/reddit/chapter/existing1/" },
        last_updated: 100,
        reddit_id: "existing1"
      }
    }
  };
  const serialized = `${JSON.stringify(currentArchive, null, 2)}\n`;
  let putCount = 0;

  const fetchImpl = async (url) => {
    if (url.startsWith("https://www.reddit.com/r/Seihantai/search.json?")) {
      return jsonResponse({
        data: {
          after: null,
          children: [{
            data: {
              id: "existing1",
              title: "Existing gallery",
              created_utc: 100,
              is_gallery: true,
              gallery_data: { items: [{}] }
            }
          }]
        }
      });
    }

    if (url === "https://api.github.com/repos/ashergz/daily-tairazuma/contents/cubari.json?ref=main") {
      return jsonResponse({ sha: "same-sha", content: encode(serialized), encoding: "base64" });
    }

    if (url === "https://api.github.com/repos/ashergz/daily-tairazuma/contents/cubari.json") {
      putCount += 1;
      return jsonResponse({}, 500);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await syncGitHubArchive({ GITHUB_TOKEN: "test-token" }, fetchImpl);

  assert.deepEqual(result, { changed: false, posts: 1, chapterCount: 1 });
  assert.equal(putCount, 0);
});
