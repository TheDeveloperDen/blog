import { resolve } from "node:path";
import { $ } from "bun";
import { readAnnouncements } from "./post";

/*
 * Tells the Discord bot (`POST /api/blog/announce`) about the _new_ posts (i.e. no edits/removals) that a push to master added.
 * Run from GitHub Actions, which provides BEFORE (the previous commit), GITHUB_SHA, ANNOUNCE_URL and ANNOUNCE_TOKEN.
 *
 * If the diff can't be computed to determine which posts are new, this throws an exception so the Action will fail.
 * Individual posts that can't be parsed will be skipped with a warning.
 */

const { BEFORE, GITHUB_SHA, ANNOUNCE_URL, ANNOUNCE_TOKEN } = process.env;
const root = resolve(import.meta.dir, "..");

const added =
	await $`git -C ${root} diff --diff-filter=A --name-only ${BEFORE} ${GITHUB_SHA} -- 'posts/*/index.md'`.text();
const slugs = added
	.split("\n")
	.map((path) => path.split("/")[1])
	.filter((slug): slug is string => !!slug && slug !== "_template");
if (slugs.length === 0) process.exit(0);

const { posts, warnings } = readAnnouncements(root, slugs);
for (const warning of warnings) console.error(`::warning::${warning}`);

const response = await fetch(ANNOUNCE_URL as string, {
	method: "POST",
	headers: {
		Authorization: `Bearer ${ANNOUNCE_TOKEN}`,
		"Content-Type": "application/json",
	},
	body: JSON.stringify({ posts }),
});
if (!response.ok)
	throw new Error(
		`Announce failed: ${response.status} ${await response.text()}`,
	);
