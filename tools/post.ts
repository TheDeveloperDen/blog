import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Paragraph, PhrasingContent, Root } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString as plainText } from "mdast-util-to-string";
import {
	PostSchema,
	parseMarkdown,
	readFrontmatter,
	SLUG_PATTERN,
} from "./frontmatter";
import { reasonOf } from "./problem";

const MAX_PARAGRAPHS = 3;
const MAX_EXCERPT_LENGTH = 1000;

/**
 * What the Discord bot is told about a newly published post (`POST /api/blog/announce`).
 */
export interface Announcement {
	/** The post's folder name, which is also its web address */
	readonly slug: string;
	readonly title: string;
	readonly authors: readonly string[];
	readonly tags: readonly string[];
	/**
	 * A preview of the post that will be rendered in Discord: the post's `summary` if it has one,
	 * otherwise its first few paragraphs.
	 */
	readonly excerpt: string;
}

/** Reads the post `slug` from its `index.md` text. */
export function announcementOf(slug: string, markdown: string): Announcement {
	const { frontmatter, tree } = parseMarkdown(markdown);
	if (frontmatter === undefined)
		throw new Error(`Post ${slug} has no frontmatter block`);

	const result = readFrontmatter(
		`posts/${slug}/index.md`,
		PostSchema,
		frontmatter,
	);
	if (!result.ok)
		throw new Error(result.problems.map((p) => p.message).join("\n"));

	const { title, authors, tags = [], summary } = result.data;
	return {
		slug,
		title,
		authors,
		tags,
		excerpt:
			summary === undefined
				? excerptOf(tree)
				: renderParagraph([{ type: "text", value: summary }]),
	};
}

/**
 * The first few paragraphs of the post that fit, as markdown. The first paragraph is always shown, trimmed if necessary.
 * Headings, lists, code, etc are stripped out, since they don't read well as a preview
 */
function excerptOf(tree: Root): string {
	const paragraphs = tree.children
		.filter(
			(node): node is Paragraph =>
				node.type === "paragraph" &&
				// a paragraph of only pictures has no useful text to show
				!node.children.every(
					(child) =>
						child.type === "image" ||
						child.type === "imageReference" ||
						child.type === "html",
				),
		)
		.map((paragraph) => ({
			paragraph,
			markdown: renderParagraph(paragraph.children),
		}))
		.filter(({ markdown }) => markdown !== "");

	const [first] = paragraphs;
	if (!first) return "";
	if (first.markdown.length > MAX_EXCERPT_LENGTH)
		// cutting formatted text could break formatting, so just make it plain text before cutting
		return cutAtWord(plainText(first.paragraph).replace(/\s+/g, " ").trim());

	const shown = [first.markdown];
	let length = first.markdown.length;
	for (const { markdown } of paragraphs.slice(1, MAX_PARAGRAPHS)) {
		length += markdown.length;
		if (length > MAX_EXCERPT_LENGTH) break;
		shown.push(markdown);
	}
	const text = shown.join("\n\n");
	return shown.length < paragraphs.length ? `${text}\n\n...` : text;
}

function cutAtWord(text: string): string {
	return `${text.slice(0, MAX_EXCERPT_LENGTH - 1).replace(/\s+\S*$/, "")}…`;
}

function renderParagraph(children: PhrasingContent[]): string {
	return toMarkdown({
		type: "paragraph",
		children: children.flatMap(forDiscord),
	}).trim();
}

/**
 * Strips anything that Discord can't render, or replaces with a textual equivalent if possible
 */
function forDiscord(node: PhrasingContent): PhrasingContent[] {
	switch (node.type) {
		case "text":
			return [{ ...node, value: node.value.replace(/\s*\n\s*/g, " ") }];
		case "break":
			return [{ type: "text", value: "\n" }];
		case "image":
		case "imageReference":
			// replace an image with its alt text
			return node.alt ? [{ type: "text", value: node.alt }] : [];
		case "html":
		case "footnoteReference":
			return [];
		case "link":
			return /^https?:\/\//.test(node.url) // external links work, but relative ones won't
				? [{ ...node, children: node.children.flatMap(forDiscord) }]
				: node.children.flatMap(forDiscord);
		case "linkReference":
			return node.children.flatMap(forDiscord);
		case "strong":
		case "emphasis":
			return [{ ...node, children: node.children.flatMap(forDiscord) }];
		default:
			return [node];
	}
}

/**
 * Reads the posts `slugs` under `root`, returning the successful announcements and any warnings about unparseable posts
 */
export function readAnnouncements(
	root: string,
	slugs: readonly string[],
): { posts: Announcement[]; warnings: string[] } {
	const posts: Announcement[] = [];
	const warnings: string[] = [];
	for (const slug of slugs) {
		try {
			if (!SLUG_PATTERN.test(slug)) throw new Error("it is not a valid name");
			const text = readFileSync(join(root, "posts", slug, "index.md"), "utf8");
			posts.push(announcementOf(slug, text));
		} catch (error) {
			warnings.push(`Skipping ${slug}: ${reasonOf(error)}`);
		}
	}
	return { posts, warnings };
}
