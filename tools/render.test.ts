import { describe, expect, test } from "bun:test";
import { problem, type Span } from "./problem";
import { feedback, MARKER, renderProblemTerminalText } from "./render";

const FILE = "posts/a/index.md";
const SOURCE = "---\ntitle: Hi\ndate: 10/22\n---\n";
const DATE_VALUE: Span = {
	start: { line: 3, column: 7 },
	end: { line: 3, column: 12 },
};
const sourceOf = () => SOURCE;
const dateProblem = problem(
	FILE,
	"`date` should look like 2026-10-22.",
	DATE_VALUE,
);

describe("terminalText", () => {
	test("shows the line with the problem underlined", () => {
		expect(renderProblemTerminalText(dateProblem, SOURCE)).toBe(
			[
				`✗ ${FILE}:3:7`,
				"  `date` should look like 2026-10-22.",
				"",
				"    1 | ---",
				"    2 | title: Hi",
				"  > 3 | date: 10/22",
				"      |       ^^^^^",
				"    4 | ---",
				"    5 |",
				"",
			].join("\n"),
		);
	});

	test("copes with problems that have no line or no file", () => {
		expect(renderProblemTerminalText(problem(FILE, "Oops."))).toBe(
			`✗ ${FILE}\n  Oops.\n`,
		);
		expect(renderProblemTerminalText(problem(undefined, "Oops."))).toBe(
			"✗ Oops.",
		);
	});
});

describe("feedback", () => {
	test("problems in added files become inline comments on the right lines", () => {
		const result = feedback([dateProblem], new Set([FILE]), sourceOf);
		expect(result).toEqual({
			inline: [
				{
					path: FILE,
					line: 3,
					side: "RIGHT",
					body: `\`date\` should look like 2026-10-22.\n\n${MARKER}`,
				},
			],
		});
	});

	test("a problem over several lines starts its comment on the first", () => {
		const span: Span = {
			start: { line: 2, column: 1 },
			end: { line: 4, column: 3 },
		};
		const [comment] = feedback(
			[problem(FILE, "x", span)],
			new Set([FILE]),
			sourceOf,
		).inline;
		expect(comment).toMatchObject({ start_line: 2, line: 4 });
	});

	test("everything else goes into one general comment, with the line shown", () => {
		const result = feedback(
			[dateProblem, problem(undefined, "Reach level 30 first.")],
			new Set(),
			sourceOf,
		);
		expect(result.inline).toEqual([]);
		expect(result.general).toContain(
			`**\`${FILE}\`**, line 3: \`date\` should look like`,
		);
		expect(result.general).toContain("> 3 | date: 10/22");
		expect(result.general).toContain("Reach level 30 first.");
		expect(result.general).toEndWith(MARKER);
	});

	test("no problems means nothing to post", () => {
		expect(feedback([], new Set(), sourceOf)).toEqual({ inline: [] });
	});
});
