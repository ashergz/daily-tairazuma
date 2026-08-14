import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fetchRedditPosts,
  serializeArchive,
  buildArchive
} from "./archive-core.mjs";

export * from "./archive-core.mjs";

export async function syncArchive({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  fetchImpl = fetch
} = {}) {
  const file = path.join(root, "cubari.json");
  const posts = await fetchRedditPosts(fetchImpl, {
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    userAgent: process.env.REDDIT_USER_AGENT
  });
  let existing = null;

  if (existsSync(file)) {
    existing = JSON.parse(await fs.readFile(file, "utf8"));
  }

  const archive = buildArchive(posts, existing);
  await fs.writeFile(file, serializeArchive(archive), "utf8");
  return { file, posts: posts.length, chapters: Object.keys(archive.chapters).length };
}

const invokedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (invokedFile && import.meta.url === invokedFile) {
  syncArchive()
    .then(result => console.log(`Synced ${result.chapters} chapters from ${result.posts} Reddit posts.`))
    .catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
