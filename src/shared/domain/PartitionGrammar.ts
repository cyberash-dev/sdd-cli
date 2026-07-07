/*
 * Single source of truth for the partition-prefix grammar (CST-007),
 * imported by both `MarkerParser` and `Config` so the two cannot drift.
 */

/*
 * One or more lowercase tokens joined by `:`, so adopters can namespace
 * partitions (e.g. `bridge:commands`).
 */
export const PARTITION_PREFIX_RE_SRC = "[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*";

/*
 * Normative-ID tail (CST-007): uppercase type segments joined by `-`, then a
 * `-<digits>` ordinal (e.g. `INV-002`, `POL-AUTH-001`). No `:`, so the
 * rightmost-`:` split in `MarkerParser.lastIndexOf(":")` stays unambiguous.
 */
export const ID_TAIL_RE_SRC = "[A-Z]+(?:-[A-Z]+)*-\\d+";

export const PARTITION_NAME_RE = new RegExp(`^${PARTITION_PREFIX_RE_SRC}$`);

/*
 * Config `baseline_id` grammar, in lockstep with schema/sdd.config.schema.json
 * and CTR-003: a single-segment `TYPE-<num>` tail, deliberately narrower than
 * ID_TAIL_RE_SRC so the CLI never accepts an id the published schema rejects.
 */
export const BASELINE_ID_RE = new RegExp(
	`^${PARTITION_PREFIX_RE_SRC}:[A-Z]+-\\d+$`,
);
