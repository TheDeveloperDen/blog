import { afterEach, describe, expect, test } from "bun:test";
import { announcementOf, readAnnouncements } from "./post";
import { makeFakeRepo, removeRepos } from "./testing";

afterEach(removeRepos);

const post = (frontmatter: string, body = "Body") =>
	`---\n${frontmatter}\n---\n\n${body}\n`;

describe("announcementOf", () => {
	const excerptFor = (
		body: string,
		frontmatter = "title: A\nauthors: [alice]",
	) => announcementOf("a", post(frontmatter, body)).excerpt;

	test("reads the frontmatter, using the summary as the excerpt when there is one", () => {
		expect(
			announcementOf(
				"my-post",
				post(
					"title: My post\nauthors: [alice, bob]\ntags: [java]\nsummary: A *short* one",
					"Not shown",
				),
			),
		).toEqual({
			slug: "my-post",
			title: "My post",
			authors: ["alice", "bob"],
			tags: ["java"],
			// the summary is plain text, so its asterisks are escaped
			excerpt: "A \\*short\\* one",
		});
	});

	test("without tags there are none", () => {
		expect(
			announcementOf("a", post("title: A\nauthors: [alice]")).tags,
		).toEqual([]);
	});

	test("shows the first paragraphs with their formatting, skipping headings and images", () => {
		const body = [
			"# A heading",
			"",
			"![A screenshot](shot.png)",
			"",
			"Today I **finally** worked out [classes](https://example.com)",
			"in `Java`.",
			"",
			"See [the notes](notes.md) and ![a diagram](d.png).",
			"",
			"- a list",
			"",
			"Third.",
		].join("\n");
		expect(excerptFor(body)).toBe(
			[
				"Today I **finally** worked out [classes](https://example.com) in `Java`.",
				"See the notes and a diagram.",
				"Third.",
			].join("\n\n"),
		);
	});

	test("shows at most three paragraphs, and says if there is more", () => {
		expect(excerptFor("One.\n\nTwo.\n\nThree.")).toBe("One.\n\nTwo.\n\nThree.");
		expect(excerptFor("One.\n\nTwo.\n\nThree.\n\nFour.")).toBe(
			"One.\n\nTwo.\n\nThree.\n\n...",
		);
	});

	test("stops before a paragraph that would make it too long", () => {
		const long = "word ".repeat(250).trim();
		expect(excerptFor(`Short.\n\n${long}\n\nAfter.`)).toBe("Short.\n\n...");
	});

	test("cuts a too long first paragraph at a word, as plain text", () => {
		const excerpt = excerptFor(`**${"word ".repeat(400).trim()}**`);
		expect(excerpt.length).toBeLessThanOrEqual(1000);
		expect(excerpt).toEndWith("word…");
		expect(excerpt).not.toContain("*");
	});

	test("keeps line breaks the author wrote, but not where the source is wrapped", () => {
		expect(excerptFor("wrapped\nhere  \nnew line")).toBe(
			"wrapped here\nnew line",
		);
	});

	test("the excerpt is empty if the post has no paragraph", () => {
		expect(excerptFor("# Just a title\n\n![shot](a.png)")).toBe("");
	});

	test("rejects a post without frontmatter, or with wrong frontmatter", () => {
		expect(() => announcementOf("a", "Body only")).toThrow("frontmatter");
		expect(() => announcementOf("a", post("authors: [alice]"))).toThrow(
			"title",
		);
	});
});

describe("readAnnouncements", () => {
	test("skips posts it can't read and keeps the rest", () => {
		const root = makeFakeRepo({
			"posts/good/index.md": post("title: Good\nauthors: [alice]"),
			"posts/broken/index.md": post("authors: [alice]"),
		});

		const { posts, warnings } = readAnnouncements(root, [
			"broken",
			"missing",
			"../etc",
			"good",
		]);

		expect(posts.map((p) => p.slug)).toEqual(["good"]);
		expect(warnings).toHaveLength(3);
		expect(warnings.join("\n")).toContain("Skipping ../etc: it is not a valid");
	});
});
