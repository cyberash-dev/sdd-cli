# Справочник команд

> Русский · [English](commands.md)

Полный справочник по каждой подкоманде `agent-sdd`: флаги, коды возврата и
формы вывода. О стоящих за ними концепциях см.
[sdd-methodology.ru.md](sdd-methodology.ru.md); о конфигурации см.
[configuration.ru.md](configuration.ru.md).

Все команды **работают со спецификацией только на чтение, кроме** `sdd approve` / `sdd finalize`
(атомарная запись `lifecycle.status` + `approval_record`) и `sdd record set`/`add`
(редактирование одного draft/proposed-записи). `sdd refresh` пишет только в stdout.

Каждый вывод в JSON несёт `format_version: 1` и стабильные строки `reason` —
вышестоящий инструментарий может закрепляться за ними.

---

## Установка CLI

### Реестр npm (рекомендуется)

```sh
npm install --save-dev agent-sdd
```

`sdd` попадает в `node_modules/.bin/sdd`, запускается через `npx sdd …`.

### Локальный путь (разработка CLI рядом с потребителем)

```sh
npm install --save-dev "file:../sdd-cli"
```

Правки в `sdd-cli/` подхватываются после `npm run build`.

### tarball `npm pack` (замороженный артефакт, без реестра)

```sh
cd sdd-cli && npm run build && npm pack        # → agent-sdd-<version>.tgz
cd ../consumer && npm install --save-dev /path/to/agent-sdd-1.4.0.tgz
```

---

## Цикл свежести/спецификации

### `sdd token`

Вычислить и напечатать текущий отпечаток области на `HEAD`.

```sh
sdd token                    # человекочитаемый
sdd token --format=json
```

JSON при успехе:

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

JSON при грязной области:

```json
{ "format_version": 1, "ok": false, "reason": "baseline-dirty", "dirty_paths": ["src/foo.ts"] }
```

`sdd token` завершается с кодом **1**, когда рабочее дерево грязное внутри области —
CLI никогда не вычисляет токен по незакоммиченным изменениям. Неотслеживаемые файлы внутри области
считаются грязью.

### `sdd check`

Сравнить свежевычисленный токен со значением, записанным в блоке
baseline.

```sh
sdd check
sdd check --format=json
```

| Код возврата | Reason | Значение |
|------|--------|---------|
| 0 | — | Записанный токен совпадает с пересчитанным; дерево чистое в области. |
| 1 | `baseline-stale` | Дерево чистое, но записанный токен отличается от пересчитанного. |
| 1 | `baseline-dirty` | В рабочем дереве есть незакоммиченные изменения в области; проверка прерывается досрочно. |

Типичный гейт дрейфа. При `baseline-stale` запустите `sdd refresh` и согласуйте
спецификацию; при `baseline-dirty` закоммитьте или отложите в stash.

### `sdd refresh`

Сравнить текущее состояние области с записанным `baseline_commit_sha` и выдать
по одной заготовке на каждый дрейфнувший путь.

```sh
sdd refresh                  # по умолчанию: --format=yaml
sdd refresh --format=json
sdd refresh --format=human
```

Каждый изменившийся путь раскладывается по корзинам:

- **Внутри footprint `IMP-*`** → заготовка `Delta`, называющая IMP-id(ы), чей
  `binding` покрывает этот путь, плюс `target_ids` этого IMP. Человек заполняет
  `compatibility_action`, `kind_of_change`, `tests_old_behavior`,
  `tests_new_behavior`.
- **Внутри области, но вне всякого footprint** → заготовка `Open-Q`, спрашивающая, следует ли
  привязать путь к нормативному ID.

Поток YAML (по умолчанию):

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

`sdd refresh` завершается с кодом **0** даже когда выдаёт заготовки — он композируем
(`sdd refresh > stubs.yaml`). *Сигнал* дрейфа — это `sdd check`, а не `sdd
refresh`. Он пишет только в stdout; применяйте заготовки к спецификации вручную (INV-002
запрещает автозапись).

---

## Линтинг и утверждение спецификации

### `sdd lint`

Прогнать правила spec-lint SDD по каждому файлу, совпавшему с `lint.spec_files` (с откатом
к единственному `spec_file`). Никогда не изменяет спецификацию.

```sh
sdd lint                     # человекочитаемый
sdd lint --format=json
```

Каждая нарушающая запись порождает одну диагностику. Идентификаторы правил (например,
`sdd:weasel-word`, `sdd:approval-record-required`,
`sdd:test-obligation-required`) добавляются только на дополнение — раз опубликованные, никогда не переименовываются.

Конверт JSON:

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

| Код возврата | Значение |
|------|---------|
| 0 | Все ошибки устранены (предупреждения допускаются). |
| 1 | ≥ 1 диагностика уровня error (`ok: false`). |
| 2 | Ошибка argv (неизвестный флаг, неверный формат). |
| 3 | Ошибка окружения (например, отсутствует `.sdd/config.json`). |

### `sdd approve`

Записать человеческое одобрение, которое продвинет один или несколько `proposed`-ID к
`approved` (или `deprecated` / `removed`). **Это шаг 1 из двух** — он пишет
*ожидающую аттестацию* в артефакт plan-пространства имён (`.sdd/plans/<plan_id>.yaml`)
и **не** меняет `lifecycle.status`. Запустите `sdd finalize`, чтобы применить его.

```sh
sdd approve \
  --id "my-partition:BEH-014" \
  --approver alice \
  --owner-role tech-lead \
  --change-request "https://example.com/pr/42"
```

**Обязательные флаги:** `--id`, `--approver`, `--owner-role`, `--change-request`.

**Необязательные флаги:**

- `--scope <string>` (по умолчанию `first-time-approval`)
- `--target-status approved|deprecated|removed` (по умолчанию `approved`)
- `--reviewed-test-oracle <ref>` (рекомендуется для Surface с major-бампом)
- `--plan <plan_id>` — добавить к конкретному плану. **Опустите его**, чтобы CLI отчеканил
  грамматически валидный id и записал `.sdd/plans/.active`; последующие вызовы `approve`
  без `--plan` добавляются к нему. Никогда не создавайте `--plan` id вручную — грамматика
  `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[a-z0-9]{5}$`.
- `--inline` — *устаревшая* одношаговая прямая запись (обходит валидацию графа).
- `--format json|human` (по умолчанию `human`)

`--id` принимает точный id или glob с `*` (например, `pol:*`). Все совпавшие записи
по всем файлам `lint.spec_files` ставятся в очередь одним пакетом.

**Самоутверждение запрещено.** CLI отказывает, когда `--approver` в
встроенном блок-листе агентов (например, `claude`, `codex`, `bot:*`, `sdd-cli`) или в вашем
`lint.approver_blocklist`.

| Код возврата | Reason | Значение |
|------|--------|---------|
| 0 | — | Хотя бы одна запись совпала и была поставлена в очередь (или записана, с `--inline`). |
| 1 | `agent-approver` | `--approver` — это идентичность агента (SDD §7.5). |
| 1 | `invalid-owner-role` | `--owner-role` не в закрытом enum. |
| 1 | `no-id-match` | `--id`/glob не совпал ни с одной записью. |
| 2 | — | Ошибка argv (отсутствует обязательный флаг, неверный `--target-status`). |

**Enum owner-role** (закрытый): `tech-lead`, `architect`, `security-owner`,
`platform-runtime-lead`, `product-owner`, `compliance`.

### `sdd finalize`

Шаг 2 утверждения: валидировать граф ссылок поставленных в очередь аттестаций активного (или `--plan`)
плана и **атомарно** переключить `lifecycle.status` каждого ID
на его целевой, записав типизированный блок `approval_record`.

```sh
sdd finalize                 # берёт активный .sdd/plans/.active
sdd finalize --plan 2026-05-20T210159Z-038af
sdd finalize --format=json
```

Записываемая запись (вложена под `lifecycle.approval_record:`; форма верхнего уровня
также принимается):

```yaml
approval_record:
  owner_role: tech-lead
  approver_identity: alice
  timestamp: 2026-04-30T10:15:42.001Z
  change_request: https://example.com/pr/42
  scope: first-time-approval
```

Если план пытается переключить ID, чьи члены Surface или ссылки Policy всё ещё
`proposed`, finalize падает с `proposed-references` — включите ссылаемые
ID в тот же план или продвиньте их первыми. Код возврата 0 при успехе, 1 при нарушении
графа / отсутствии активного плана.

### `sdd plan`

Осмотреть ожидающие аттестации утверждения, поставленные в очередь в плане.

```sh
sdd plan show                # активный план
sdd plan show --plan 2026-05-20T210159Z-038af
sdd plan show --format=json
```

Только на чтение. Используйте его перед `finalize`, чтобы точно подтвердить, какие ID переключатся.

---

## Гейт CI

### `sdd ready`

Единственная авторитетная проверка `implementation-valid` (гейт-3) для CI. Строгое
**надмножество `sdd lint` и `sdd check`**: она заново прогоняет обе под одним конвертом JSON
(kinds `aggregated_lint` / `aggregated_check`) и добавляет:

- каждый `approved`/`deprecated` ID должен иметь ≥ 1 тест, аннотированный `@covers
  <partition>:<id>`;
- каждый `removed` ID должен нести соответствующий маркер `compatibility_action=…`;
- ни один `proposed`/`draft` ID не может находиться вне `sandbox_paths`;
- сиротские / маркеры с неизвестной партицией всплывают как `[orphan_covers]` /
  `[unknown_partition_covers]`.

```sh
sdd ready                              # все партиции, человекочитаемый вывод
sdd ready --format=json                # стабильный JSON для аннотаций CI
sdd ready --partition pipeline-driver  # фильтр / рычаг поэтапного развёртывания
```

| Код возврата | Значение |
|------|---------|
| 0 | Годно к слиянию. Блокеров нет. |
| 1 | ≥ 1 блокер слияния (любой вид правила или агрегированный). |
| 2 | Не удалось оценить (`config_invalid` / `spec_parse_failed` / `unreadable_test_paths`). |

**Грамматика маркера** (`CST-007`): `@covers <partition>:<id> [key=value …]`, где
`<partition>` — это один-или-более разделённых двоеточиями токенов в нижнем регистре
(`^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$`), так что и `my-partition:BEH-001`, и
`bridge:commands:CON-004` разбираются. `<id>` совпадает с `^[A-Z]+(?:-[A-Z]+)*-\d+$` — так что
описательные хвосты вроде `pol:POL-AUTH-001` распознаются (расширено в v1.4.0,
`DLT-008`). Единственный ключ хвоста в белом списке — `compatibility_action=<value>`;
неизвестные ключи хвоста молча игнорируются (совместимость с будущим). Разделение партиции/id
идёт по самому правому `:`. Размещайте маркеры где угодно в тестовых файлах, обычно
`// @covers <id>` рядом с закрывающим тестом.

`sdd ready` **не** выполняет тесты — он побайтово сканирует тестовые файлы на маркеры и
работает с рабочим деревом только на чтение. Он проверяет *наличие* трассируемости, а не верность
теста; корректность major-бампа — это человеческое ревью.

> Кросс-партиционный тест, который законно покрывает ID из обеих партиций, должен
> появиться в `test_paths` **обеих** партиций. Неявного кросс-зачёта не
> предоставляется.

---

## Навигация по спецификации

### `sdd record`

Навигировать и редактировать большой `spec.md` по одной записи за раз, не читая и не
переписывая весь файл — спроектировано для AI-агентов, у которых окно контекста —
дефицитный ресурс.

```sh
sdd record list                            # компактный индекс всех записей
sdd record list --partition my-partition   # фильтр по одной партиции
sdd record get my-partition:BEH-001         # одна запись, дословно
sdd record set my-partition:BEH-001 --from-file body.yaml
sdd record set my-partition:BEH-001 --content "$BODY"
sdd record add --after my-partition:BEH-001 --from-file new.yaml
```

- **`list`** — по одной строке на запись: `id` · `type` · `lifecycle.status` · производный
  заголовок (`title` записи, иначе `name` Surface, иначе пусто).
  `--partition` фильтрует по партиционному компоненту id. Только на чтение (`INV-002`).
- **`get <id>`** — печатает точное исходное тело записи (round-trip обратно в
  `set`). `--format=json` добавляет `file`, `start_line`, `end_line`. Код возврата 1, если не
  найдено.
- **`set <id>`** — заменяет тело существующей **draft/proposed**-записи на
  месте; окружающий fence и маркеры `---` сохраняются. Тело из
  `--from-file` или `--content`, голое или обёрнутое в ```` ```yaml ```` (оба
  нормализуются).
- **`add --after <id>`** — вставляет новую обёрнутую в ```` ```yaml ```` запись прямо
  после якоря. `id` тела должен быть новым, а его статус — `draft`/`proposed`.

`set`/`add` **отказывают на записях `approved`/`deprecated`/`removed`** (код возврата 1,
`record-protected`) — изменение управляемой записи — это работа `Delta` +
`approve`/`finalize`. Запись атомарна (temp-файл + rename) и затрагивает
только один файл спецификации (`INV-015`); всё остальное, плюс `.sdd/config.json` и
`.git/`, побайтово идентично. Всегда запускайте `sdd lint` после `set`/`add` — тело
вставляется дословно, так что lint остаётся структурным гейтом.

**Коды возврата:** 0 успех · 1 `record-not-found` / `anchor-not-found` /
`duplicate-id` / `record-protected` / промах get · 2 `invalid-body`.

---

## Обслуживание и отчётность

### `sdd report`

Выдать скелет PR-сводки (закрытые обязательства тестов, внутренние решения,
допущения, оставшиеся Open-Q) относительно базового ref.

```sh
sdd report --pr-summary
sdd report --pr-summary --against main
sdd report --pr-summary --format=json
```

`--pr-summary` обязателен. Механическая часть — это скелет; расширьте
секцию «Internal decisions» вручную перед вставкой в описание PR.

### `sdd doctor`

Проверить, что установленный CLI и ваш `enforcement_registry.md` согласны по версиям
правил.

```sh
sdd doctor --rule-version
sdd doctor --rule-version --rules rules/enforcement_registry.md
sdd doctor --rule-version --format=json
```

`--rule-version` обязателен; `--rules` по умолчанию
`rules/enforcement_registry.md`. Он сообщает `version_mismatch` /
`missing_diagnostic` (реестр объявляет правило, которое CLI не публикует) /
`stale_diagnostic` (CLI публикует правило, которое реестр не знает). Запускайте на
свежем checkout или после бампа версии.

### `sdd install`

Распространить правила методологии SDD (+ хуки Claude) в конфиг вашего агента.
Полностью задокументировано в [installing-rules.ru.md](installing-rules.ru.md).

```sh
sdd install all                  # ~/.claude + ~/.codex
sdd install claude --dry-run
sdd install all --scope project  # в ЭТОТ репозиторий
```

---

## Форматы вывода

| Подкоманда | `human` | `json` | `yaml` |
|------------|---------|--------|--------|
| `sdd token` | по умолчанию | да | — |
| `sdd check` | по умолчанию | да | — |
| `sdd refresh` | да | да | по умолчанию |
| `sdd lint` | по умолчанию | да | — |
| `sdd approve` | по умолчанию | да | — |
| `sdd finalize` | по умолчанию | да | — |
| `sdd plan` | по умолчанию | да | — |
| `sdd ready` | по умолчанию | да | — |
| `sdd record` | по умолчанию | да | — |
| `sdd report` | по умолчанию | да | — |
| `sdd doctor` | по умолчанию | да | — |
| `sdd install` | по умолчанию | да | — |

Вывод в формате human — это однострочная сводка плюс детализация с отступом, и он опускает
временную метку `emitted_at`.

---

## Таксономия кодов возврата

```
0  clean / success
1  drift / violation / refusal   (refresh-with-stubs is NOT 1)
2  configuration error
3  environment error
```

| Код | Reason | Откуда |
|------|--------|-----------|
| 0 | — | Успешный прогон. |
| 1 | `baseline-dirty` | Незакоммиченные изменения, затрагивающие область. |
| 1 | `baseline-stale` | Записанный токен ≠ пересчитанному. |
| 1 | `agent-approver` / `invalid-owner-role` / `no-id-match` | Отказы `sdd approve`. |
| 2 | `config-missing` | `.sdd/config.json` не существует. |
| 2 | `config-invalid` | Нарушение схемы, битый JSON, неразрешимый `baseline_commit_sha`, glob области с нулём совпадений, … |
| 2 | `baseline-block-missing` | Нет блока с `id == config.baseline_id`. |
| 2 | `baseline-block-duplicate` | Несколько блоков с одинаковым `id`. |
| 3 | `git-not-on-path` | Бинарник `git` не на `PATH`. |
| 3 | `not-a-git-repo` | cwd не внутри рабочего дерева git. |
| 3 | `head-unborn` | Репозиторий существует, но `HEAD` не разрешается. |

---

## Встроенный механизм git-токена (`git_tree_hash_v1`)

```
1. git diff --quiet HEAD -- <scope>     # ненулевой → baseline-dirty (код 1)
2. git ls-tree HEAD -- <scope>          # захватить байты stdout дословно
3. token = hex(sha256(stdout_bytes))
4. commit_sha = trim(git rev-parse HEAD)
5. emit { token, commit_sha, mechanism, scope }
```

Детерминизм проистекает из канонического вывода `ls-tree` от git: для фиксированного коммита и
набора pathspec байты идентичны от вызова к вызову, а переупорядочивание элементов области
не меняет токен.

Встроенный git-адаптер использует строгий allowlist подкоманд: `diff --quiet HEAD`,
`ls-tree HEAD`, `rev-parse HEAD`, `rev-parse --is-inside-work-tree`, `diff
--name-only baseline..HEAD`, `status --porcelain`, `show <ref>:<path>`. Ни одна
изменяющая состояние подкоманда никогда не вызывается (`POL-002`). Когда `vcs` выбирает
внешний адаптер, `mechanism` и байты отпечатка приходят от этого адаптера
вместо этого — см. [writing-vcs-adapters.ru.md](writing-vcs-adapters.ru.md).
