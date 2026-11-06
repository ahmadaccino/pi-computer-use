import assert from "node:assert/strict";
import { normalizeFindParams } from "../src/find-params.ts";

assert.deepEqual(normalizeFindParams(undefined), {
	text: undefined,
	app: undefined,
	bundleId: undefined,
	pid: undefined,
	kind: undefined,
});

assert.deepEqual(
	normalizeFindParams({
		text: "  editor  ",
		app: "  TextEdit  ",
		bundleId: "  com.apple.TextEdit  ",
		pid: 42,
		kind: "window",
	}),
	{
		text: "editor",
		app: "TextEdit",
		bundleId: "com.apple.TextEdit",
		pid: 42,
		kind: "window",
	},
);

for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
	assert.throws(
		() => normalizeFindParams({ pid }),
		/find_roots\.pid must be a positive integer when provided\./,
		`expected pid ${pid} to be rejected`,
	);
}

assert.deepEqual(normalizeFindParams({ app: " Engine DJ ", launch: true, waitMs: 1500.4 }), {
	text: undefined,
	app: "Engine DJ",
	bundleId: undefined,
	pid: undefined,
	kind: undefined,
	launch: true,
	waitMs: 1500,
});
assert.throws(() => normalizeFindParams({ launch: true }), /find_roots\.launch requires app or bundleId/);
assert.throws(() => normalizeFindParams({ app: "x", waitMs: 90_000 }), /waitMs must be between 0 and 60000/);

console.log("Find parameter checks passed.");
