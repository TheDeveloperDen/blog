import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { components, operations } from "@octokit/openapi-types";
import { PostSchema } from "./frontmatter";
import { messages } from "./messages";
import { MARKER } from "./render";
import { makeFakeRepo, removeRepos } from "./testing";

/*
 * Runs the real `cli.ts` as a separate process against a throwaway repository, with a fake
 * GitHub API and a fake bot on local ports. These tests cover what the unit tests can't:
 * the environment wiring, the exit code, and exactly what is sent to GitHub.
 */

const GOOD_POST = "---\ntitle: Hi\nauthors: [alice]\n---\n\nHello\n";
const ALLOWED_LINES = Object.keys(PostSchema.shape);
const BAD_POST = GOOD_POST.replace("title: Hi", "title: Hi\nextra: 1");
const BOB_POST = GOOD_POST.replace("[alice]", "[bob]");

/*
 * The fake's shapes come from GitHub's published API description, so a wrong field name or value
 * in these tests fails the type check instead of quietly testing nothing.
 */
type Schemas = components["schemas"];
type JsonBody<Operation extends keyof operations> =
	operations[Operation] extends {
		requestBody?: { content: { "application/json": infer Body } };
	}
		? Body
		: never;
type CreateReview = JsonBody<"pulls/create-review">;
type CreateComment = JsonBody<"issues/create-comment">;

interface Call {
	method: string;
	path: string;
	body?: unknown;
}
type Comment = Pick<Schemas["pull-request-review-comment"], "id" | "body"> & {
	user: Pick<Schemas["simple-user"], "type">;
};
interface PullRequestState {
	files: Pick<Schemas["diff-entry"], "filename" | "status">[];
	reviewComments?: Comment[];
	issueComments?: Comment[];
	/** Makes creating a review fail, as if GitHub were having a bad day. */
	failReview?: boolean;
}

const PR = "/repos/devden/blog/pulls/7";
const ISSUE = "/repos/devden/blog/issues/7";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterAll(() => {
	for (const server of servers) void server.stop(true);
});
afterEach(removeRepos);

function fakeGitHub(state: PullRequestState) {
	const calls: Call[] = [];
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const { pathname } = new URL(request.url);
			const method = request.method;
			const body = method === "POST" ? await request.json() : undefined;
			calls.push({ method, path: pathname, body });

			if (method === "GET" && pathname === `${PR}/files`)
				return Response.json(state.files);
			if (method === "GET" && pathname === `${PR}/comments`)
				return Response.json(state.reviewComments ?? []);
			if (method === "GET" && pathname === `${ISSUE}/comments`)
				return Response.json(state.issueComments ?? []);
			if (method === "DELETE") return new Response(null, { status: 204 });
			if (method === "POST" && pathname === `${PR}/reviews`)
				return state.failReview
					? new Response("{}", { status: 500 })
					: Response.json({ id: 1 });
			if (method === "POST" && pathname === `${ISSUE}/comments`)
				return Response.json({ id: 2 }, { status: 201 });
			return new Response("unexpected request", { status: 404 });
		},
	});
	servers.push(server);
	return { url: String(server.url), calls };
}

/** A bot that answers every request with `answer`, and remembers what it was asked. */
function fakeBot(answer: { linked: boolean; level: number }) {
	const asked: { path: string; auth: string | null }[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			asked.push({
				path: new URL(request.url).pathname,
				auth: request.headers.get("Authorization"),
			});
			return Response.json(answer);
		},
	});
	servers.push(server);
	return { url: `${server.url}api/github`, asked };
}

async function runCli(env: Record<string, string>) {
	const process = Bun.spawn([Bun.argv[0] ?? "bun", "cli.ts"], {
		cwd: import.meta.dir,
		// Explicit, so nothing from the machine running the tests (like a real GITHUB_TOKEN) leaks in.
		env: { PATH: Bun.env.PATH ?? "", ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		process.exited,
	]);
	return { stdout, exitCode };
}

/** The environment GitHub Actions would give the CLI for PR number 7. */
function pullRequestEnv(
	repoFiles: Record<string, string>,
	github: { url: string },
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		ROOT: makeFakeRepo(repoFiles),
		GITHUB_TOKEN: "token",
		GITHUB_REPOSITORY: "devden/blog",
		GITHUB_API_URL: github.url,
		PR_NUMBER: "7",
		...extra,
	};
}

const bodiesOf = <Body = unknown>(
	calls: Call[],
	method: string,
	path: string,
): Body[] =>
	calls
		.filter((c) => c.method === method && c.path === path)
		.map((c) => c.body as Body);
const deletedPaths = (calls: Call[]) =>
	calls.filter((c) => c.method === "DELETE").map((c) => c.path);

describe("running locally", () => {
	test("prints problems with the offending line and fails", async () => {
		const root = makeFakeRepo({ "posts/hello/index.md": BAD_POST });
		const { stdout, exitCode } = await runCli({ ROOT: root });
		expect(exitCode).toBe(1);
		expect(stdout).toContain("posts/hello/index.md:3:1");
		expect(stdout).toContain(messages.unknownLine("extra", ALLOWED_LINES));
		expect(stdout).toContain("> 3 | extra: 1");
	});

	test("passes a good repository", async () => {
		const root = makeFakeRepo({ "posts/hello/index.md": GOOD_POST });
		expect(await runCli({ ROOT: root })).toEqual({
			stdout: expect.stringContaining("All checks passed.\n"),
			exitCode: 0,
		});
	});
});

describe("on a pull request", () => {
	test("problems in a new file become inline comments, and older feedback is replaced", async () => {
		const github = fakeGitHub({
			files: [{ filename: "posts/hello/index.md", status: "added" }],
			reviewComments: [
				{ id: 10, body: `old\n\n${MARKER}`, user: { type: "Bot" } },
				{ id: 11, body: "a reviewer's remark", user: { type: "User" } },
				{ id: 12, body: `pretending\n\n${MARKER}`, user: { type: "User" } },
			],
			issueComments: [
				{ id: 20, body: `old\n\n${MARKER}`, user: { type: "Bot" } },
			],
		});
		const env = pullRequestEnv({ "posts/hello/index.md": BAD_POST }, github);

		const { exitCode } = await runCli(env);

		expect(exitCode).toBe(1);
		// Only our own earlier comments are removed.
		expect(deletedPaths(github.calls).sort()).toEqual([
			"/repos/devden/blog/issues/comments/20",
			"/repos/devden/blog/pulls/comments/10",
		]);
		const review: CreateReview = {
			event: "COMMENT",
			comments: [
				{
					path: "posts/hello/index.md",
					line: 3,
					side: "RIGHT",
					body: `${messages.unknownLine("extra", ALLOWED_LINES)}\n\n${MARKER}`,
				},
			],
		};
		expect(bodiesOf(github.calls, "POST", `${PR}/reviews`)).toEqual([review]);
		expect(bodiesOf(github.calls, "POST", `${ISSUE}/comments`)).toEqual([]);
	});

	test("problems in an edited file go into one general comment instead", async () => {
		const github = fakeGitHub({
			files: [{ filename: "posts/hello/index.md", status: "modified" }],
		});
		const env = pullRequestEnv({ "posts/hello/index.md": BAD_POST }, github);

		expect((await runCli(env)).exitCode).toBe(1);

		expect(bodiesOf(github.calls, "POST", `${PR}/reviews`)).toEqual([]);
		const [comment] = bodiesOf<CreateComment>(
			github.calls,
			"POST",
			`${ISSUE}/comments`,
		);
		expect(comment?.body).toContain("`posts/hello/index.md`**, line 3");
		expect(comment?.body).toContain("> 3 | extra: 1");
	});

	test("once everything is fixed, the old feedback is removed and nothing new is posted", async () => {
		const github = fakeGitHub({
			files: [{ filename: "posts/hello/index.md", status: "added" }],
			reviewComments: [
				{ id: 10, body: `old\n\n${MARKER}`, user: { type: "Bot" } },
			],
			issueComments: [
				{ id: 20, body: `old\n\n${MARKER}`, user: { type: "Bot" } },
			],
		});
		const env = pullRequestEnv({ "posts/hello/index.md": GOOD_POST }, github);

		const { stdout, exitCode } = await runCli(env);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("All checks passed.");
		expect(deletedPaths(github.calls)).toHaveLength(2);
		expect(github.calls.filter((c) => c.method === "POST")).toEqual([]);
	});

	test("only the files the PR touches are checked against its author", async () => {
		const repo = {
			"posts/alices/index.md": GOOD_POST,
			"posts/bobs/index.md": BOB_POST,
		};
		const bobsOwn = fakeGitHub({
			files: [{ filename: "posts/bobs/index.md", status: "added" }],
		});
		const alices = fakeGitHub({
			files: [{ filename: "posts/alices/index.md", status: "modified" }],
		});

		const own = await runCli(
			pullRequestEnv(repo, bobsOwn, { PR_AUTHOR: "bob" }),
		);
		const other = await runCli(
			pullRequestEnv(repo, alices, { PR_AUTHOR: "bob" }),
		);

		expect(own.exitCode).toBe(0);
		expect(other.exitCode).toBe(1);
		expect(other.stdout).toContain(messages.notAuthoringOwnPost("bob"));
	});

	test("a GitHub failure is reported but doesn't change the verdict", async () => {
		const github = fakeGitHub({
			files: [{ filename: "posts/hello/index.md", status: "added" }],
			failReview: true,
		});
		const env = pullRequestEnv({ "posts/hello/index.md": BAD_POST }, github);

		const { stdout, exitCode } = await runCli(env);

		expect(exitCode).toBe(1);
		expect(stdout).toContain(messages.unknownLine("extra", ALLOWED_LINES));
		expect(stdout).toContain("Couldn't post the problems on the PR");
	});
});

describe("eligibility", () => {
	const env = (github: { url: string }, bot: { url: string }) =>
		pullRequestEnv({ "posts/hello/index.md": GOOD_POST }, github, {
			PR_AUTHOR: "alice",
			ELIGIBILITY_URL: bot.url,
			ELIGIBILITY_TOKEN: "secret",
		});
	const newPost: PullRequestState = {
		files: [{ filename: "posts/hello/index.md", status: "added" }],
	};

	test("someone who hasn't linked their accounts fails, and is told why on the PR", async () => {
		const github = fakeGitHub(newPost);
		const bot = fakeBot({ linked: false, level: 0 });

		const { exitCode } = await runCli(env(github, bot));

		expect(exitCode).toBe(1);
		expect(bot.asked).toEqual([
			{ path: "/api/github/alice", auth: "Bearer secret" },
		]);
		const [comment] = bodiesOf<CreateComment>(
			github.calls,
			"POST",
			`${ISSUE}/comments`,
		);
		expect(comment?.body).toContain(messages.notLinked("alice"));
	});

	test("someone with enough levels passes", async () => {
		const github = fakeGitHub(newPost);
		const bot = fakeBot({ linked: true, level: 30 });
		expect((await runCli(env(github, bot))).exitCode).toBe(0);
	});

	test("a bot that can't be reached only warns", async () => {
		const github = fakeGitHub(newPost);
		const { stdout, exitCode } = await runCli(
			env(github, { url: "http://127.0.0.1:1/api/github" }),
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("! Couldn't check whether alice can post");
		expect(github.calls.filter((c) => c.method === "POST")).toEqual([]);
	});
});
