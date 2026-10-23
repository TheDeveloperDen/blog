import { describe, expect, test } from "bun:test";
import {
	AuthorSchema,
	helpFor,
	PostSchema,
	parseMarkdown,
	readFrontmatter,
} from "./frontmatter";
import { fieldIssues, messages } from "./messages";

describe("parseMarkdown", () => {
	const frontmatterOf = (text: string) => parseMarkdown(text).frontmatter;

	test("finds the details at the top", () => {
		expect(frontmatterOf("---\ntitle: Hi\n---\n\nBody\n")).toBe("title: Hi");
	});

	test("copes with Windows line endings", () => {
		expect(frontmatterOf("---\r\ntitle: Hi\r\n---\r\nBody")).toBe("title: Hi");
	});

	test("accepts an empty details block", () => {
		expect(frontmatterOf("---\n---\nBody")).toBe("");
	});

	test("only a line of exactly --- closes the details", () => {
		expect(frontmatterOf("---\ntitle: a---b\n---\nBody")).toBe("title: a---b");
		expect(frontmatterOf("---\ntitle: Hi\n----\nBody")).toBeUndefined();
	});

	test("returns undefined without a details block", () => {
		expect(frontmatterOf("Body only")).toBeUndefined();
		expect(frontmatterOf("---\ntitle: never closed")).toBeUndefined();
	});
});

describe("readFrontmatter", () => {
	const read = (details: string) =>
		readFrontmatter("posts/a/index.md", PostSchema, details);
	const help = (name: string) => helpFor(PostSchema, name);
	const messagesOf = (details: string) => {
		const result = read(details);
		return result.ok ? [] : result.problems.map((p) => p.message);
	};

	test("returns typed data when everything is right", () => {
		const result = read("title: Hi\nauthors: [alice]\ntags: [java]");
		expect(result).toEqual({
			ok: true,
			data: {
				title: "Hi",
				authors: ["alice"],
				tags: ["java"],
			},
		});
	});

	test("reports every mistake at once", () => {
		expect(messagesOf("title: Hi\nextra: 1")).toEqual([
			messages.missingLine("authors", help("authors")),
			messages.unknownLine("extra", Object.keys(PostSchema.shape)),
		]);
	});

	test("points at the bad entry in a list", () => {
		expect(messagesOf("title: Hi\nauthors: [alice, not a name]")).toEqual([
			messages.malformedEntry(
				"authors",
				" (entry 2)",
				fieldIssues.notGithubName,
				help("authors"),
			),
		]);
	});

	test("explains a list written as plain text", () => {
		expect(messagesOf("title: Hi\nauthors: alice")).toEqual([
			messages.malformedEntry(
				"authors",
				"",
				fieldIssues.notAList,
				help("authors"),
			),
		]);
	});

	test("rejects empty and non-text values", () => {
		expect(messagesOf("title: ''\nauthors: [alice]")).toEqual([
			messages.malformedEntry("title", "", fieldIssues.empty, help("title")),
		]);
		expect(messagesOf("title: [a]\nauthors: [alice]")).toEqual([
			messages.malformedEntry("title", "", fieldIssues.notText, help("title")),
		]);
	});

	test("an empty author list is rejected", () => {
		expect(messagesOf("title: Hi\nauthors: []")).toEqual([
			messages.malformedEntry(
				"authors",
				"",
				fieldIssues.needsOne,
				help("authors"),
			),
		]);
	});

	test("tags must be slugs", () => {
		expect(messagesOf("title: Hi\nauthors: [a]\ntags: [Game Dev]")).toEqual([
			messages.malformedEntry(
				"tags",
				" (entry 1)",
				fieldIssues.notSlug,
				help("tags"),
			),
		]);
	});

	test("a second colon in a value is fixed using the actual value", () => {
		expect(messagesOf("title: movie: a review")).toEqual([
			messages.frontmatterUnreadable(
				"BLOCK_AS_IMPLICIT_KEY",
				"",
				'title: "movie: a review"',
			),
		]);
		expect(messagesOf('title: say "hi": ok')).toEqual([
			expect.stringContaining('Try `title: "say \\"hi\\": ok"`.'),
		]);
	});

	test("a value starting with a reserved character is quoted", () => {
		expect(messagesOf("title: @home")).toEqual([
			expect.stringContaining('Try `title: "@home"`.'),
		]);
	});

	test("only the first YAML mistake is reported", () => {
		expect(messagesOf("title: Hi\n  tags: 1")).toHaveLength(1);
	});

	test("broken YAML is explained", () => {
		expect(messagesOf("title: [")).toEqual([
			expect.stringContaining("couldn't be read"),
		]);
	});

	test("details that aren't name: value lines are explained", () => {
		expect(messagesOf("- just\n- a list")).toEqual([
			messages.frontmatterNotValidType,
		]);
	});

	test("empty details report what is missing", () => {
		expect(messagesOf("")).toEqual([
			messages.missingLine("title", help("title")),
			messages.missingLine("authors", help("authors")),
		]);
	});

	test("works for other schemas", () => {
		const result = readFrontmatter("authors/a.md", AuthorSchema, "name: Alice");
		expect(result).toEqual({ ok: true, data: { name: "Alice" } });
	});
});
