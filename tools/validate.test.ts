import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PostSchema } from "./frontmatter";
import { messages } from "./messages";
import { makeFakeRepo, removeRepos } from "./testing";
import { validate } from "./validate";

const POST = "---\ntitle: Hi\nauthors: [alice]\n---\n\nHello\n";
const PROFILE = "---\nname: Alice\n---\n\nHi, I'm Alice.\n";
const REPO_ROOT = resolve(import.meta.dir, "..");

afterEach(removeRepos);

/**
 * Builds a throwaway repository from `files`, validates it, and returns the messages.
 * `changedFiles` limits the PR-author checks to what the PR touches; leave it out for "everything".
 */
function messagesFor(
	files: Record<string, string>,
	prAuthor?: string,
	changedFiles?: string[],
): string[] {
	const pr = prAuthor
		? {
				author: prAuthor,
				touches: (prefix: string) =>
					!changedFiles || changedFiles.some((file) => file.startsWith(prefix)),
			}
		: undefined;
	return validate(makeFakeRepo(files), pr).map((p) => p.message);
}

const postWith = (body: string) => `${POST}${body}`;

describe("a valid repository", () => {
	test("a minimal post passes", () => {
		expect(messagesFor({ "posts/hello/index.md": POST })).toEqual([]);
	});

	test("an empty repository passes", () => {
		expect(messagesFor({})).toEqual([]);
	});

	test("the committed templates pass", () => {
		const root = mkdtempSync(join(tmpdir(), "blog-"));
		try {
			cpSync(join(REPO_ROOT, "posts/_template"), join(root, "posts/template"), {
				recursive: true,
			});
			cpSync(
				join(REPO_ROOT, "authors/_template.md"),
				join(root, "authors/someone.md"),
			);
			expect(validate(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true });
		}
	});

	test("templates (folders starting with _) are skipped", () => {
		expect(messagesFor({ "posts/_draft/index.md": "not even valid" })).toEqual(
			[],
		);
	});
});

describe("post folders", () => {
	test("the folder name must be a lowercase slug", () => {
		expect(messagesFor({ "posts/Bad_Slug/index.md": POST })).toEqual([
			messages.badSlug,
		]);
	});

	test("a loose file in posts/ is rejected", () => {
		expect(messagesFor({ "posts/notes.md": POST })).toEqual([
			messages.postNotInFolder,
		]);
	});

	test("index.md is required", () => {
		expect(messagesFor({ "posts/hello/cover.png": "" })).toEqual([
			messages.postNeedsIndex,
		]);
	});

	test("only images may sit next to index.md", () => {
		const found = messagesFor({
			"posts/hello/index.md": POST,
			"posts/hello/cover.PNG": "",
			"posts/hello/notes.txt": "",
		});
		expect(found).toEqual([messages.extraFileInPost]);
	});
});

describe("post details", () => {
	test("a post without details is explained", () => {
		expect(messagesFor({ "posts/a/index.md": "just text" }).join()).toContain(
			messages.needsFrontmatter("post"),
		);
	});

	test("a date line is rejected, since dates come from git", () => {
		const post = POST.replace("title: Hi", "title: Hi\ndate: 2026-10-22");
		expect(messagesFor({ "posts/a/index.md": post }).join()).toContain(
			messages.unknownLine("date", Object.keys(PostSchema.shape)),
		);
	});
});

describe("the PR author", () => {
	test("must be one of the post's authors", () => {
		expect(messagesFor({ "posts/hello/index.md": POST }, "bob")).toEqual([
			messages.notAuthoringOwnPost("bob"),
		]);
	});

	test("is compared ignoring case", () => {
		expect(messagesFor({ "posts/hello/index.md": POST }, "ALICE")).toEqual([]);
	});

	test("may be one of several authors", () => {
		const post = POST.replace("[alice]", "[carol, alice]");
		expect(messagesFor({ "posts/hello/index.md": post }, "alice")).toEqual([]);
	});
});

describe("where problems are", () => {
	const spansFor = (files: Record<string, string>) => {
		// Pick line and column only: Markdown positions also carry an `offset`.
		const pick = (p?: { line: number; column: number }) =>
			p && { line: p.line, column: p.column };
		return validate(makeFakeRepo(files)).map((p) => [
			pick(p.span?.start),
			pick(p.span?.end),
		]);
	};
	const at = (line: number, column: number) => ({ line, column });

	test("a bad value points at the value", () => {
		const post = POST.replace("[alice]", "alice");
		expect(spansFor({ "posts/a/index.md": post })).toEqual([
			[at(3, 10), at(3, 15)],
		]);
	});

	test("an unknown line points at the whole entry", () => {
		const post = POST.replace("---\n\nHello", "extra: 1\n---\n\nHello");
		expect(spansFor({ "posts/a/index.md": post })).toEqual([
			[at(4, 1), at(4, 9)],
		]);
	});

	test("a missing line points at the opening ---", () => {
		const post = POST.replace("title: Hi\n", "");
		expect(spansFor({ "posts/a/index.md": post })).toEqual([
			[at(1, 1), at(1, 4)],
		]);
	});

	test("an image points at the image", () => {
		const post = postWith("Hi\n\n![](ok.png) there");
		expect(
			spansFor({ "posts/a/index.md": post, "posts/a/ok.png": "" }),
		).toEqual([[at(9, 1), at(9, 12)]]);
	});

	test("a YAML mistake points at the broken place", () => {
		const post = POST.replace("title: Hi", "title: Hi\ntitle: Yo");
		expect(spansFor({ "posts/a/index.md": post })).toEqual([
			[at(3, 1), at(3, 2)],
		]);
		expect(messagesFor({ "posts/a/index.md": post })).toEqual([
			expect.stringContaining("twice"),
		]);
	});
});

describe("a PR in a repository with other people's work", () => {
	const repo = {
		"posts/hello/index.md": POST, // by alice
		"posts/mine/index.md": POST.replace("[alice]", "[bob]"),
		"posts/mine/pic.png": "",
		"authors/alice.md": PROFILE,
	};

	test("only the files the PR touches are checked against its author", () => {
		expect(messagesFor(repo, "bob", ["posts/mine/index.md"])).toEqual([]);
	});

	test("touching someone else's post is caught, even if only an image", () => {
		expect(messagesFor(repo, "bob", ["posts/hello/pic.png"])).toEqual([
			messages.notAuthoringOwnPost("bob"),
		]);
	});

	test("touching someone else's profile is caught", () => {
		expect(messagesFor(repo, "bob", ["authors/alice.md"])).toEqual([
			messages.profileNotYours("bob"),
		]);
	});
});

describe("symlinks", () => {
	test("are rejected, and nothing is read through them", () => {
		const root = mkdtempSync(join(tmpdir(), "blog-"));
		try {
			mkdirSync(join(root, "posts/hello"), { recursive: true });
			symlinkSync("/etc/hostname", join(root, "posts/hello/index.md"));
			expect(validate(root)).toEqual([
				{
					file: "posts/hello/index.md",
					message: messages.symlink,
				},
			]);
		} finally {
			rmSync(root, { recursive: true });
		}
	});
});

describe("images", () => {
	const files = (body: string) => ({
		"posts/hello/index.md": postWith(body),
		"posts/hello/ok.png": "",
	});

	test("an image next to the post with alt text is fine", () => {
		expect(messagesFor(files("![A screenshot](ok.png)"))).toEqual([]);
	});

	test("alt text is required", () => {
		expect(messagesFor(files("![](ok.png)"))).toEqual([
			messages.imageNeedsAlt("ok.png"),
		]);
	});

	test("the image must exist", () => {
		expect(messagesFor(files("![Oops](missing.png)"))).toEqual([
			messages.imageMissing("missing.png"),
		]);
	});

	test("reference-style images are checked too", () => {
		expect(
			messagesFor(files("![Hi][pic]\n\n[pic]: https://example.com/a.png")),
		).toEqual([messages.imageInSubfolder("https://example.com/a.png")]);
		expect(messagesFor(files("![Hi][pic]\n\n[pic]: ok.png"))).toEqual([]);
	});

	test("image syntax inside code is not an image", () => {
		expect(
			messagesFor(files("```\n![](nope.png)\n```\n\n`![](nope.png)`")),
		).toEqual([]);
	});

	test("raw HTML is rejected, once", () => {
		const html = '<img src="https://example.com/a.png"> and <b>bold</b>';
		expect(messagesFor(files(html))).toEqual([messages.htmlNotAllowed]);
	});

	test("links to other places are rejected", () => {
		const found = messagesFor(
			files("![Hi](https://example.com/a.png)\n![Hi](../other/a.png)"),
		);
		expect(found).toEqual([
			messages.imageInSubfolder("https://example.com/a.png"),
			messages.imageInSubfolder("../other/a.png"),
		]);
	});
});

describe("author profiles", () => {
	test("a profile named after its owner is fine", () => {
		expect(messagesFor({ "authors/alice.md": PROFILE }, "alice")).toEqual([]);
	});

	test("a profile with no details at all is fine", () => {
		expect(messagesFor({ "authors/alice.md": "---\n---\n" })).toEqual([]);
	});

	test("people can only add their own profile", () => {
		expect(messagesFor({ "authors/alice.md": PROFILE }, "bob")).toEqual([
			messages.profileNotYours("bob"),
		]);
	});

	test("the file must be named after a GitHub username", () => {
		const message = messages.badProfileName;
		expect(messagesFor({ "authors/alice.txt": PROFILE })).toEqual([message]);
		expect(messagesFor({ "authors/not a name.md": PROFILE })).toEqual([
			message,
		]);
	});

	test("a profile needs its details block", () => {
		expect(messagesFor({ "authors/alice.md": "Hi!" })).toEqual([
			messages.needsFrontmatter("profile"),
		]);
	});

	test("unknown lines in a profile are rejected", () => {
		expect(
			messagesFor({ "authors/alice.md": "---\ndiscord: 123\n---\n" }),
		).toEqual([messages.unknownLine("discord", ["name"])]);
	});
});
