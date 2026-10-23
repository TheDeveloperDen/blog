import { afterAll, describe, expect, test } from "bun:test";
import { checkEligibility } from "./eligibility";

/** A stand-in for the bot that answers every request with `respond`. */
function fakeBot(respond: (request: Request) => Response) {
	return Bun.serve({ port: 0, fetch: respond });
}

const servers: ReturnType<typeof fakeBot>[] = [];
function botAnswering(respond: (request: Request) => Response): string {
	const server = fakeBot(respond);
	servers.push(server);
	return String(server.url);
}
afterAll(() => {
	for (const server of servers) void server.stop(true);
});

const answer = (linked: boolean, level: number) => () =>
	Response.json({ linked, level });

describe("checkEligibility", () => {
	test("asks the bot about the right user, with the token", async () => {
		const asked: { path: string; auth: string | null }[] = [];
		const url = botAnswering((request) => {
			asked.push({
				path: new URL(request.url).pathname,
				auth: request.headers.get("Authorization"),
			});
			return Response.json({ linked: true, level: 30 });
		});
		expect(await checkEligibility("alice", url, "secret")).toEqual({
			kind: "eligible",
		});
		expect(asked).toEqual([{ path: "/alice", auth: "Bearer secret" }]);
	});

	test("level 30 is enough, 29 is not", async () => {
		const enough = botAnswering(answer(true, 30));
		const short = botAnswering(answer(true, 29));
		expect((await checkEligibility("alice", enough, "t")).kind).toBe(
			"eligible",
		);
		expect(await checkEligibility("alice", short, "t")).toEqual({
			kind: "ineligible",
			message: expect.stringContaining("level 30"),
		});
	});

	test("the message never reveals the person's level", async () => {
		const url = botAnswering(answer(true, 12));
		const result = await checkEligibility("alice", url, "t");
		expect(result.kind === "ineligible" && result.message).not.toContain("12");
	});

	test("someone who hasn't linked their accounts can't post", async () => {
		const url = botAnswering(answer(false, 0));
		expect(await checkEligibility("alice", url, "t")).toEqual({
			kind: "ineligible",
			message: expect.stringContaining("linked"),
		});
	});

	test("an error from the bot never blocks a PR", async () => {
		const url = botAnswering(() => new Response("no", { status: 401 }));
		expect(await checkEligibility("alice", url, "t")).toEqual({
			kind: "unknown",
			message: expect.stringContaining("HTTP 401"),
		});
	});

	test("an answer in the wrong shape never blocks a PR", async () => {
		const url = botAnswering(() => Response.json({ allowed: "yes" }));
		expect((await checkEligibility("alice", url, "t")).kind).toBe("unknown");
	});

	test("a bot that isn't running never blocks a PR", async () => {
		const result = await checkEligibility("alice", "http://127.0.0.1:1/", "t");
		expect(result.kind).toBe("unknown");
	});

	test("a bad bot address never blocks a PR", async () => {
		expect((await checkEligibility("alice", "not a url", "t")).kind).toBe(
			"unknown",
		);
	});
});
