import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArchive,
  classifyPost,
  COVER_URL,
  fetchRedditOAuthPosts,
  parseRedditRss,
  serializeArchive
} from "../scripts/sync.mjs";

const gallery = {
  id: "gallery1",
  title: "Gallery chapter",
  created_utc: 100,
  is_gallery: true,
  gallery_data: { items: [{ media_id: "one" }] }
};

test("classifies galleries, direct Reddit images, and skips non-images", () => {
  const galleryResult = classifyPost(gallery);
  assert.equal(galleryResult.type, "gallery");
  assert.equal(galleryResult.group, "/proxy/api/reddit/chapter/gallery1/");

  const imageResult = classifyPost({
    id: "image1",
    title: "Single image",
    created_utc: 200,
    url: "https://i.redd.it/hze05qtmcihh1.jpeg"
  });
  assert.equal(imageResult.type, "image");
  assert.deepEqual(imageResult.group, ["https://i.redd.it/hze05qtmcihh1.jpeg"]);

  assert.equal(classifyPost({
    id: "article1",
    title: "Mangadex link",
    created_utc: 300,
    url: "https://mangadex.org/title/example"
  }), null);

  assert.equal(classifyPost({
    id: "preview1",
    title: "Article with preview image",
    created_utc: 400,
    url: "https://example.com/article",
    preview: { images: [{ source: { url: "https://external-preview.redd.it/preview.png" } }] }
  }), null);
});

test("keeps existing chapter numbers and appends new posts chronologically", () => {
  const initial = buildArchive([gallery]);
  const next = buildArchive([
    gallery,
    {
      id: "image1",
      title: "Single image",
      created_utc: 200,
      url_overridden_by_dest: "https://i.redd.it/new.jpeg"
    },
    {
      id: "article1",
      title: "Not an image",
      created_utc: 300,
      url: "https://example.com/article"
    }
  ], initial);

  assert.deepEqual(Object.keys(next.chapters), ["1", "2"]);
  assert.equal(next.chapters["1"].reddit_id, "gallery1");
  assert.equal(next.chapters["2"].reddit_id, "image1");
  assert.deepEqual(next.chapters["2"].groups.Reddit, ["https://i.redd.it/new.jpeg"]);
});

test("removes a previously misclassified post when Reddit now identifies it as non-image", () => {
  const existing = buildArchive([{
    id: "article1",
    title: "Previously misclassified",
    created_utc: 100,
    url: "https://i.redd.it/old.jpeg"
  }]);
  const next = buildArchive([{
    id: "article1",
    title: "Actually an article",
    created_utc: 100,
    url: "https://example.com/article"
  }], existing);
  assert.deepEqual(next.chapters, {});
});

test("serializes valid deterministic JSON", () => {
  const parsed = JSON.parse(serializeArchive(buildArchive([gallery])));
  assert.equal(parsed.title, "Daily Tairazuma");
  assert.equal(parsed.artist, "@allegro365sui");
  assert.equal(parsed.cover, COVER_URL);
  assert.equal(parsed.chapters["1"].last_updated, 100);
});

test("parses RSS gallery and direct-image entries", () => {
  const posts = parseRedditRss(`
    <feed>
      <entry>
        <id>https://www.reddit.com/r/Seihantai/comments/gallery1/gallery/</id>
        <title>Gallery chapter</title>
        <link rel="alternate" href="https://www.reddit.com/r/Seihantai/gallery/gallery1" />
        <updated>2026-08-14T00:00:00Z</updated>
      </entry>
      <entry>
        <id>https://www.reddit.com/r/Seihantai/comments/image1/single/</id>
        <title>Single image</title>
        <content type="html">&lt;a href=&quot;https://i.redd.it/single.jpeg&quot;&gt;</content>
        <updated>2026-08-14T00:01:00Z</updated>
      </entry>
    </feed>
  `);

  assert.equal(posts.length, 2);
  assert.equal(posts[0].is_gallery, true);
  assert.equal(posts[1].url, "https://i.redd.it/single.jpeg");
});

test("uses Reddit app-only OAuth for the structured listing", async () => {
  const calls = [];
  const posts = await fetchRedditOAuthPosts(async (url, options) => {
    calls.push({ url, options });
    if (url === "https://www.reddit.com/api/v1/access_token") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "test-token" })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          after: null,
          children: [{ data: { id: "oauth1", title: "OAuth gallery", created_utc: 100, is_gallery: true, gallery_data: { items: [{}] } } }]
        }
      })
    };
  }, { clientId: "client", clientSecret: "secret", userAgent: "test-agent" });

  assert.equal(posts[0].id, "oauth1");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["User-Agent"], "test-agent");
  assert.equal(calls[0].options.body, "grant_type=client_credentials");
  assert.equal(calls[1].options.headers.Authorization, "bearer test-token");
  assert.match(calls[1].url, /^https:\/\/oauth\.reddit\.com\/r\/Seihantai\/search\?/);
});
