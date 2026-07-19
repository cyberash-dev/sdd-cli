# Command reference

> English · [Русский](commands.ru.md)

Complete reference for every `agent-sdd` subcommand: flags, exit codes, and
output shapes. For the concepts behind them see
[sdd-methodology.md](sdd-methodology.md); for configuration see
[configuration.md](configuration.md).

All commands are **read-only on the spec except** `sdd approve` / `sdd finalize`
(atomic `lifecycle.status` + `approval_record` write) and `sdd record set`/`add`
(single draft/proposed record edit). `sdd refresh` writes only to stdout.

Every JSON output carries `format_version: 1` and stable `reason` strings —
downstream tooling can pin against them.

---

## Installing the CLI

### npm registry (recommended)

```sh
npm install --save-dev agent-sdd
```

`sdd` lands on `node_modules/.bin/sdd`, runnable via `npx sdd …`.

### Local path (developing the CLI alongside a consumer)

```sh
npm install --save-dev "file:../sdd-cli"
```

Edits in `sdd-cli/` are picked up after `npm run build`.

### `npm pack` tarball (frozen artefact, no registry)

```sh
cd sdd-cli && npm run build && npm pack        # → agent-sdd-<version>.tgz
cd ../consumer && npm install --save-dev /path/to/agent-sdd-1.4.0.tgz
```

---

## The freshness/spec loop

### `sdd token`

Compute and print the current scope fingerprint at `HEAD`.

```sh
sdd token                    # human
sdd token --format=json
```

Success JSON:

```json
{
  "format_version": 1,
  "ok": true,
  "token": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "commit_sha": "0b0f4d84e5c7a9182f15c7f3d4e0f6a8c0e1d2b7",
  "mechanism": "git_tree_hash_v1",
  "scope": ["src", "tests", "package.json"]
}
```

Scope-dirty JSON:

```json
{ "format_version": 1, "ok": false, "reason": "baseline-dirty", "dirty_paths": ["src/foo.ts"] }
```

`sdd token` exits **1** when the working tree is dirty inside scope — the CLI
never computes a token over uncommitted changes. Untracked files inside scope
count as dirt.

### `sdd check`

Compare the freshly computed token against the value recorded in the baseline
block.

```sh
sdd check
sdd check --format=json
```

| Exit | Reason | Meaning |
|------|--------|---------|
| 0 | — | Recorded token matches the recomputed one; tree is scope-clean. |
| 1 | `baseline-stale` | Tree is clean, but the recorded token differs from the recomputed. |
| 1 | `baseline-dirty` | Working tree has uncommitted scope changes; check short-circuits. |

The typical drift gate. On `baseline-stale`, run `sdd refresh` and reconcile the
spec; on `baseline-dirty`, commit or stash.

### `sdd refresh`

Diff the current scope state against the recorded `baseline_commit_sha` and emit
one stub per drifted path.

```sh
sdd refresh                  # default: --format=yaml
sdd refresh --format=json
sdd refresh --format=human
```

Each changed path is bucketed:

- **Inside an `IMP-*` footprint** → a `Delta` stub naming the IMP-id(s) whose
  `binding` covers that path, plus the IMP's `target_ids`. A human fills
  `compatibility_action`, `kind_of_change`, `tests_old_behavior`,
  `tests_new_behavior`.
- **Inside scope but outside every footprint** → an `Open-Q` stub asking whether
  the path should be bound to a normative ID.

YAML stream (default):

```yaml
---
kind: Delta
path: "src/foo.ts"
target_imp_ids: ["my-partition:IMP-002"]
target_ids: ["my-partition:BEH-014"]
emitted_at: "2026-04-29T15:37:35.000Z"
compatibility_action: TODO
kind_of_change: TODO
tests_old_behavior: TODO
tests_new_behavior: TODO
---
kind: Open-Q
path: "spec/notes.md"
question: "Should spec/notes.md be bound to a normative ID?"
options: ["bind_to_existing_or_new_id", "leave_unmodeled"]
blocking: TODO
emitted_at: "2026-04-29T15:37:35.000Z"
```

`sdd refresh` exits **0** even when stubs are emitted — it is composable
(`sdd refresh > stubs.yaml`). The drift *signal* is `sdd check`, not `sdd
refresh`. It writes only to stdout; apply stubs to the spec by hand (INV-002
forbids auto-write).

---

## Spec linting and approval

### `sdd lint`

Run SDD spec-lint rules over every file matched by `lint.spec_files` (falling
back to the single `spec_file`). Never modifies the spec.

```sh
sdd lint                     # human
sdd lint --format=json
```

Each violating record produces one diagnostic. Rule ids (e.g.
`sdd:weasel-word`, `sdd:approval-record-required`,
`sdd:test-obligation-required`) are append-only — once published, never renamed.

JSON envelope:

```json
{
  "format_version": 1,
  "ok": false,
  "error_count": 3,
  "warn_count": 0,
  "diagnostics": [
    {
      "severity": "error",
      "rule": "sdd:approval-record-required",
      "file": "spec/spec.md",
      "line": 141,
      "message": "ID \"my:SUR-001\" has lifecycle.status=approved but no real approval_record (SDD §7.5)."
    }
  ]
}
```

| Exit | Meaning |
|------|---------|
| 0 | All errors resolved (warnings allowed). |
| 1 | ≥ 1 error-severity diagnostic (`ok: false`). |
| 2 | argv error (unknown flag, invalid format). |
| 3 | Environment error (e.g. `.sdd/config.json` missing). |

### `sdd approve`

Record a human sign-off that will promote one or more `proposed` IDs toward
`approved` (or `deprecated` / `removed`). **This is step 1 of two** — it writes a
*pending attestation* to a plan-namespace artefact (`.sdd/plans/<plan_id>.yaml`)
and does **not** change `lifecycle.status`. Run `sdd finalize` to apply it.

```sh
sdd approve \
  --id "my-partition:BEH-014" \
  --approver alice \
  --owner-role tech-lead \
  --change-request "https://example.com/pr/42"
```

**Required flags:** `--id`, `--approver`, `--owner-role`, `--change-request`.

**Optional flags:**

- `--scope <string>` (default `first-time-approval`)
- `--target-status approved|deprecated|removed` (default `approved`)
- `--reviewed-test-oracle <ref>` (recommended for major-bump Surfaces)
- `--plan <plan_id>` — append to a specific plan. **Omit it** so the CLI mints a
  grammar-valid id and writes `.sdd/plans/.active`; subsequent `approve` calls
  without `--plan` append to it. Never hand-craft a `--plan` id — the grammar is
  `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[a-z0-9]{5}$`.
- `--inline` — *deprecated* single-step direct write (bypasses graph validation).
- `--format json|human` (default `human`)

`--id` accepts an exact id or a glob with `*` (e.g. `pol:*`). All matching records
across every `lint.spec_files` file are queued in one batch.

**Self-approval is forbidden.** The CLI refuses when `--approver` is in the
built-in agent blocklist (e.g. `claude`, `codex`, `bot:*`, `sdd-cli`) or in your
`lint.approver_blocklist`.

| Exit | Reason | Meaning |
|------|--------|---------|
| 0 | — | At least one record matched and was queued (or written, with `--inline`). |
| 1 | `agent-approver` | `--approver` is an agent identity (SDD §7.5). |
| 1 | `invalid-owner-role` | `--owner-role` not in the closed enum. |
| 1 | `no-id-match` | `--id`/glob matched zero records. |
| 2 | — | argv error (missing required flag, invalid `--target-status`). |

**Owner-role enum** (closed): `tech-lead`, `architect`, `security-owner`,
`platform-runtime-lead`, `product-owner`, `compliance`.

### `sdd finalize`

Step 2 of approval: validate the reference graph of the active (or `--plan`)
plan's queued attestations and **atomically** flip each ID's `lifecycle.status`
to its target, writing the typed `approval_record` block.

```sh
sdd finalize                 # consumes .sdd/plans/.active
sdd finalize --plan 2026-05-20T210159Z-038af
sdd finalize --format=json
```

The written record (nested under `lifecycle.approval_record:`; the top-level form
is also accepted):

```yaml
approval_record:
  owner_role: tech-lead
  approver_identity: alice
  timestamp: 2026-04-30T10:15:42.001Z
  change_request: https://example.com/pr/42
  scope: first-time-approval
```

If the plan tries to flip an ID whose Surface members or Policy refs are still
`proposed`, finalize fails with `proposed-references` — include the referenced
IDs in the same plan or promote them first. Exit 0 on success, 1 on a graph
violation / no active plan.

### `sdd plan`

Inspect the pending approval attestations queued in a plan.

```sh
sdd plan show                # the active plan
sdd plan show --plan 2026-05-20T210159Z-038af
sdd plan show --format=json
```

Read-only. Use it before `finalize` to confirm exactly which IDs will flip.

---

## The CI gate

### `sdd ready`

The single, authoritative `implementation-valid` (gate-3) check for CI. A strict
**superset of `sdd lint` and `sdd check`**: it re-runs both under one JSON
envelope (kinds `aggregated_lint` / `aggregated_check`) and adds:

- every `approved`/`deprecated` ID must have ≥ 1 test annotated `@covers
  <partition>:<id>`;
- every `removed` ID must carry a matching `compatibility_action=…` marker;
- no `proposed`/`draft` ID may live outside `sandbox_paths`;
- orphan / unknown-partition markers surface as `[orphan_covers]` /
  `[unknown_partition_covers]`.

```sh
sdd ready                              # all partitions, human output
sdd ready --format=json                # stable JSON for CI annotations
sdd ready --partition pipeline-driver  # filter / staged-rollout knob
```

| Exit | Meaning |
|------|---------|
| 0 | Mergeable. No blockers. |
| 1 | ≥ 1 merge blocker (any rule kind, or aggregated). |
| 2 | Could not evaluate (`config_invalid` / `spec_parse_failed` / `unreadable_test_paths`). |

**Marker grammar** (`CST-007`): `@covers <partition>:<id> [key=value …]` where
`<partition>` is one-or-more colon-separated lowercase tokens
(`^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$`), so both `my-partition:BEH-001` and
`bridge:commands:CON-004` parse. `<id>` matches `^[A-Z]+(?:-[A-Z]+)*-\d+$` — so
descriptive tails such as `pol:POL-AUTH-001` are recognised (widened in v1.4.0,
`DLT-008`). The only whitelisted tail key is `compatibility_action=<value>`;
unknown tail keys are silently ignored (forward-compat). The partition/id split
is at the rightmost `:`. Place markers anywhere in test files, typically
`// @covers <id>` near the closing test.

`sdd ready` does **not** execute tests — it byte-scans test files for markers and
is read-only on the working tree. It verifies traceability *presence*, not test
fidelity; major-bump correctness is human review.

> A cross-partition test that legitimately covers IDs from both partitions must
> appear in **both** partitions' `test_paths`. Implicit cross-credit is not
> provided.

---

## Navigating the spec

### `sdd record`

Navigate and edit a large `spec.md` one record at a time, without reading or
rewriting the whole file — designed for AI agents whose context window is the
scarce resource.

```sh
sdd record list                            # compact index of every record
sdd record list --partition my-partition   # filter to one partition
sdd record get my-partition:BEH-001         # one record, verbatim
sdd record set my-partition:BEH-001 --from-file body.yaml
sdd record set my-partition:BEH-001 --content "$BODY"
sdd record add --after my-partition:BEH-001 --from-file new.yaml
```

- **`list`** — one row per record: `id` · `type` · `lifecycle.status` · derived
  title (the record's `title`, else a Surface's `name`, else blank).
  `--partition` filters by the id's partition component. Read-only (`INV-002`).
- **`get <id>`** — prints the record's exact source body (round-trips into
  `set`). `--format=json` adds `file`, `start_line`, `end_line`. Exit 1 if not
  found.
- **`set <id>`** — replaces the body of an existing **draft/proposed** record in
  place; the surrounding fence and `---` markers are preserved. Body from
  `--from-file` or `--content`, bare or ```` ```yaml ````-fenced (both
  normalised).
- **`add --after <id>`** — inserts a new ```` ```yaml ````-fenced record right
  after the anchor. The body's `id` must be new and its status `draft`/`proposed`.

`set`/`add` **refuse `approved`/`deprecated`/`removed` records** (exit 1,
`record-protected`) — changing a governed record is a `Delta` +
`approve`/`finalize` job. The write is atomic (temp-file + rename) and touches
only the one spec file (`INV-015`); everything else, plus `.sdd/config.json` and
`.git/`, is byte-identical. Always run `sdd lint` after `set`/`add` — the body is
spliced verbatim, so lint stays the structural gate.

**Exit codes:** 0 success · 1 `record-not-found` / `anchor-not-found` /
`duplicate-id` / `record-protected` / get-miss · 2 `invalid-body`.

---

## Maintenance and reporting

### `sdd report`

Emit a PR-summary skeleton (closed test obligations, internal decisions,
assumptions, remaining Open-Qs) against a base ref.

```sh
sdd report --pr-summary
sdd report --pr-summary --against main
sdd report --pr-summary --format=json
```

`--pr-summary` is required. The mechanical part is a skeleton — expand the
"Internal decisions" section by hand before pasting into the PR description.

### `sdd doctor`

Check that the installed CLI and your `enforcement_registry.md` agree on rule
versions.

```sh
sdd doctor --rule-version
sdd doctor --rule-version --rules rules/enforcement_registry.md
sdd doctor --rule-version --format=json
```

`--rule-version` is required; `--rules` defaults to
`rules/enforcement_registry.md`. It reports `version_mismatch` /
`missing_diagnostic` (registry declares a rule the CLI doesn't publish) /
`stale_diagnostic` (CLI publishes a rule the registry doesn't know). Run it on a
fresh checkout or after a version bump.

### `sdd install`

Distribute the SDD methodology rules (+ Claude hooks) into your agent config.
Fully documented in [installing-rules.md](installing-rules.md).

```sh
sdd install all                  # ~/.claude + ~/.codex
sdd install claude --dry-run
sdd install all --scope project  # into THIS repo
```

---

## Output formats

| Subcommand | `human` | `json` | `yaml` |
|------------|---------|--------|--------|
| `sdd token` | default | yes | — |
| `sdd check` | default | yes | — |
| `sdd refresh` | yes | yes | default |
| `sdd lint` | default | yes | — |
| `sdd approve` | default | yes | — |
| `sdd finalize` | default | yes | — |
| `sdd plan` | default | yes | — |
| `sdd ready` | default | yes | — |
| `sdd record` | default | yes | — |
| `sdd report` | default | yes | — |
| `sdd doctor` | default | yes | — |
| `sdd install` | default | yes | — |

Human-format output is a one-line summary plus indented detail and omits the
`emitted_at` timestamp.

---

## Exit-code taxonomy

```
0  clean / success
1  drift / violation / refusal   (refresh-with-stubs is NOT 1)
2  configuration error
3  environment error
```

| Code | Reason | Where from |
|------|--------|-----------|
| 0 | — | Successful run. |
| 1 | `baseline-dirty` | Scope-touching uncommitted changes. |
| 1 | `baseline-stale` | Recorded token ≠ recomputed. |
| 1 | `agent-approver` / `invalid-owner-role` / `no-id-match` | `sdd approve` refusals. |
| 2 | `config-missing` | `.sdd/config.json` does not exist. |
| 2 | `config-invalid` | Schema violation, bad JSON, unresolvable `baseline_commit_sha`, zero-match scope glob, … |
| 2 | `baseline-block-missing` | No block with `id == config.baseline_id`. |
| 2 | `baseline-block-duplicate` | Multiple blocks with the same `id`. |
| 3 | `git-not-on-path` | `git` binary not on `PATH`. |
| 3 | `not-a-git-repo` | cwd is not inside a git working tree. |
| 3 | `head-unborn` | Repo exists but `HEAD` does not resolve. |

---

## The built-in git token mechanism (`git_tree_hash_v1`)

```
1. git diff --quiet HEAD -- <scope>     # non-zero → baseline-dirty (exit 1)
2. git ls-tree HEAD -- <scope>          # capture stdout bytes verbatim
3. token = hex(sha256(stdout_bytes))
4. commit_sha = trim(git rev-parse HEAD)
5. emit { token, commit_sha, mechanism, scope }
```

Determinism comes from git's canonical `ls-tree` output: for a fixed commit and
pathspec set the bytes are identical across invocations, and reordering scope
entries does not change the token.

The built-in git adapter uses a strict subcommand allowlist: `diff --quiet HEAD`,
`ls-tree HEAD`, `rev-parse HEAD`, `rev-parse --is-inside-work-tree`, `diff
--name-only baseline..HEAD`, `status --porcelain`, `show <ref>:<path>`. No
state-mutating subcommand is ever invoked (`POL-002`). When `vcs` selects an
external adapter, the `mechanism` and fingerprint bytes come from that adapter
instead — see [writing-vcs-adapters.md](writing-vcs-adapters.md).
