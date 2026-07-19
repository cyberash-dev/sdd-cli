# Installing the SDD methodology into your agent — `sdd install`

> English · [Русский](installing-rules.ru.md)

`sdd install` makes `agent-sdd` the **distribution point for the SDD
methodology**. The CLI ships the rule set under `rules/`; `install` copies it
into your AI coding agent's configuration so that any project you open makes the
agent follow the discipline — read the spec through `sdd record`, keep code and
spec in sync, never self-approve, run the gates.

Having the `sdd` binary available is not enough on its own: the binary
*enforces* the method, but the agent has to *know* the method. `sdd install` is
what teaches it.

---

## What gets distributed

The artifact set is data-driven by [`rules/manifest.json`](../rules/manifest.json)
(never hardcoded), so it stays in lockstep with what the package ships. As of
v1.4.0 it is:

| Kind | Source | Lands as | Purpose |
|------|--------|----------|---------|
| context | `spec-driven-development.md` | an `@import`-ed / referenced rule | The condensed SDD rule, always in the agent's context. |
| context | `workflow-sdd.md` | rule | SDD-augmented development workflow (spec → lint → implement → ready). |
| context | `tdd-sdd.md` | rule | Where Red comes from; `@covers` markers; migration runtime-state. |
| context | `sdd-cli-usage.md` | rule | Phase → command mapping and operational rules for the CLI. |
| context | `review-sdd.md` | rule | Self-review checklist addendum for SDD. |
| skill | `skills/spec-driven-development/SKILL.md` | an on-demand skill | The full reference with tables + rationale, loaded when needed. |
| reference | `enforcement_registry.md` | reference file | requirement → enforcement-class → executor mapping (`ENF-*`). |
| data | `skills/…/data/weasel-words.json` | data file | The canonical weasel-word list used by lint reasoning. |
| hook | `hooks/sdd-lint-reminder.sh` | a `PreToolUse` hook (Claude) | Reminds the agent to run `sdd lint` after editing a spec file. |
| hook | `hooks/sdd-spec-read-guard.sh` | a `PreToolUse` hook (Claude) | Denies `Read`/`cat`/`grep` of `spec/*.md`, forcing `sdd record`. |

The context rules are small and always-on; the skill is the deep manual pulled
in on demand; the two hooks are the *mechanical* half that keeps a Claude agent
honest even when it forgets the rule.

---

## Targets

```sh
sdd install claude       # ~/.claude
sdd install codex        # ~/.codex
sdd install all          # both
```

### `claude`

- The context rules are copied to `~/.claude/sdd/` and pulled into a **managed
  block** in `~/.claude/CLAUDE.md` via `@import`.
- The full reference is installed as an **on-demand skill** at
  `~/.claude/skills/spec-driven-development/SKILL.md`.
- Two `PreToolUse` **hooks** are merged into `~/.claude/settings.json`:
  - a **lint reminder** — non-blocking; nudges the agent to run `sdd lint` after
    it edits a spec file;
  - a **spec-read guard** — *blocking*; denies reading `spec/*.md` directly in any
    project that carries `.sdd/config.json`, so the agent navigates the spec with
    `sdd record list` / `get` instead of loading the whole file into context.

### `codex`

- Every rule is copied to `~/.codex/sdd/` and listed in a managed block in
  `~/.codex/AGENTS.md`.
- Codex has no `@import` mechanism and no hook host, so the hooks are **reported
  as skipped** — the rules still apply, but the two enforcement hooks are
  Claude-only.

---

## User scope vs project scope

```sh
sdd install claude                 # --scope user   (default)
sdd install all --scope project    # into THIS repo
```

- **`user`** (default) — writes under the agent home roots: `~/.claude` and
  `~/.codex`. This is the "set it once, every project benefits" mode.
  `$SDD_INSTALL_HOME` overrides the home root (useful for testing).
- **`project`** — writes the agent config into the **current repository** so a
  team can commit the SDD setup and share it:
  - `./CLAUDE.md` and `./AGENTS.md` at the repo root;
  - rules, skills, and `settings.json` under `./.claude/**` and `./.codex/**`.

  Project-scope `settings.json` hook commands use
  `$CLAUDE_PROJECT_DIR/.claude/sdd/…` (not absolute paths), so a committed
  `settings.json` is portable across machines and checkouts.

Project scope writes **only** that agent-config set. It never touches
`spec/*.md`, `.sdd/config.json`, `.git`, or your source. This is a hard boundary
(`INV-016` / `POL-003` / `POL-001`) — `install` is *not* a scaffolding command
and will not seed a spec or a config for you.

---

## Safety properties

- **Plan-then-apply.** If any packaged source file is missing, `install` aborts
  *before writing anything* (exit 1, `artifact-missing` / `manifest-missing` /
  `manifest-invalid`). You never get a half-written config.
- **Idempotent.** Managed blocks are replaced in place; hook entries are deduped
  by matcher + command; pre-existing user hooks are preserved. Running it twice
  is a no-op beyond refreshing the managed content.
- **Bounded writes.** Under `--scope user` it writes only inside the agent home
  roots; under `--scope project` only inside the repo's agent-config set. It is
  the *one* command allowed to write outside the repo, and even then only into
  those roots.

---

## Preview and machine output

```sh
sdd install all --dry-run          # print the planned file ops, write nothing
sdd install claude --format=json   # stable JSON envelope for scripting
```

`--dry-run` prints exactly which files would be written, which managed blocks
replaced, and which hooks merged — run it first if you want to see the blast
radius before committing to it.

### Exit codes

| Exit | Reason | Meaning |
|------|--------|---------|
| 0 | — | Install (or `--dry-run` plan) completed. |
| 1 | `manifest-missing` / `manifest-invalid` / `artifact-missing` | A packaged rule file or the manifest could not be read; nothing was written. |
| 2 | — | argv error (missing/unknown target, unknown flag). |

---

## After installing

Open any project that carries `.sdd/config.json` with your agent. You should
see:

- the SDD rules in the agent's always-on context;
- (Claude) a refusal when the agent tries to `Read` / `cat` / `grep` `spec/*.md`,
  redirecting it to `sdd record`;
- (Claude) a reminder to run `sdd lint` after the agent edits a spec file;
- the `spec-driven-development` skill available for the agent to pull the full
  reference on demand.

To update the rules after upgrading `agent-sdd`, just run `sdd install` again —
it is idempotent and refreshes the managed blocks in place.

---

## See also

- [sdd-methodology.md](sdd-methodology.md) — the method these rules encode.
- [commands.md](commands.md) — the full command reference, including `sdd record`
  which the spec-read guard steers the agent toward.
