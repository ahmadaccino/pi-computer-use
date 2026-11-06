import type { FindParams } from "./contract.ts";

export function normalizeFindParams(params: FindParams | null | undefined): FindParams {
	const rawParams = params ?? {};
	if (rawParams.pid !== undefined && (!Number.isFinite(rawParams.pid) || !Number.isInteger(rawParams.pid) || rawParams.pid <= 0)) {
		throw new Error("find_roots.pid must be a positive integer when provided.");
	}
	if (rawParams.waitMs !== undefined && (!Number.isFinite(rawParams.waitMs) || rawParams.waitMs < 0 || rawParams.waitMs > 60_000)) {
		throw new Error("find_roots.waitMs must be between 0 and 60000 when provided.");
	}
	const normalized: FindParams = {
		text: trimOrUndefined(rawParams.text),
		app: trimOrUndefined(rawParams.app),
		bundleId: trimOrUndefined(rawParams.bundleId),
		pid: rawParams.pid,
		kind: rawParams.kind,
	};
	if (rawParams.launch === true) {
		if (!normalized.app && !normalized.bundleId) throw new Error("find_roots.launch requires app or bundleId.");
		normalized.launch = true;
	}
	if (rawParams.waitMs !== undefined) normalized.waitMs = Math.round(rawParams.waitMs);
	return normalized;
}

function trimOrUndefined(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
