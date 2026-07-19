# Написание VCS-адаптера для `agent-sdd`

> Русский · [English](writing-vcs-adapters.md)

`agent-sdd` читает состояние системы контроля версий вашего репозитория через
единственный порт — контракт `Vcs`. **Встроенный адаптер вызывает git** и
используется по умолчанию. Если ваш репозиторий управляется другой системой
контроля версий, вы можете поставить внешний адаптер в виде **отдельного
npm-пакета** и выбрать его в `.sdd/config.json` — сам `agent-sdd` остаётся
VCS-нейтральным и никогда не зависит от вашего адаптера.

Это руководство — всё, что нужно, чтобы написать такой адаптер. Оно не
предполагает никаких знаний о внутреннем устройстве `agent-sdd` сверх того, что
изложено в этом документе.

---

## Зачем нужен адаптер

Каждая операция `agent-sdd`, затрагивающая контроль версий, проходит через
восемь методов: определить репозиторий, найти его корень, прочитать головную
ревизию, снять фингерпринт с набора путей, перечислить файлы под этими путями,
перечислить «грязные» пути, перечислить пути, изменившиеся с базовой ревизии, и
прочитать один файл на заданной ревизии. Встроенный git-адаптер реализует их
через `git`. Адаптер для другой VCS реализует те же восемь методов через CLI
(или библиотеку) этой VCS.

Токен свежести — хеш, который `agent-sdd` записывает в блок Brownfield-baseline
спецификации — это `sha256(fingerprint-bytes)`, где байты берутся из метода
`treeBytes` вашего адаптера. Таким образом, адаптер полностью определяет, что
означает «содержимое репозитория» для этого токена.

---

## Как `agent-sdd` выбирает и загружает адаптер

Поле `vcs` в `.sdd/config.json` выбирает адаптер:

- **отсутствует или `"git"`** → встроенный git-адаптер (по умолчанию; поведение
  без изменений);
- **любая другая строка** → **спецификатор модуля** вашего пакета-адаптера.

Загрузка детерминирована и работает по принципу fail-closed:

1. `agent-sdd` разрешает модуль **из `node_modules` потребляющего
   репозитория** (а не из своей собственной установки) — голое имя пакета вроде
   `my-vcs-adapter` разрешается так же, как это сделал бы `require()` из корня
   вашего репозитория; путь (`./adapters/local.js`, абсолютный) разрешается
   относительно корня репозитория и должен оставаться внутри него.
2. Он импортирует модуль и выбирает **фабрику**: именованный экспорт
   `createVcs`, фабричную функцию по умолчанию или объект по умолчанию,
   предоставляющий `createVcs`.
3. Он вызывает `createVcs({ repoRoot })` и **проверяет форму возвращённого
   объекта** (все восемь методов присутствуют и вызываемы, `mechanism` — строка,
   соответствующая грамматике ниже).
4. Он проверяет, что `mechanism` адаптера **равен** `config.mechanism`.

Любая неудача — модуль не найден, нет фабрики, отсутствует метод, некорректный
`mechanism` или несовпадение с `config.mechanism` — завершается кодом `2`
(ошибка конфигурации) с описательным сообщением и ничего не меняет. Адаптер
работает **внутри процесса и считается доверенным**; `agent-sdd` проверяет его
форму, а не поведение.

---

## Контракт `Vcs`

Ваша фабрика возвращает объект, реализующий этот интерфейс (показан на
TypeScript; обычный JS-объект с теми же методами тоже подходит):

```ts
interface Vcs {
  readonly mechanism: string;
  isGitRepo(cwd: string): Promise<boolean>;
  repoRoot(cwd: string): Promise<string>;
  headSha(repoRoot: string): Promise<string>;
  treeBytes(repoRoot: string, scope: readonly string[]): Promise<Uint8Array>;
  treePaths(repoRoot: string, scope: readonly string[]): Promise<string[]>;
  dirtyPaths(repoRoot: string, scope: readonly string[]): Promise<string[]>;
  changedPaths(
    repoRoot: string,
    baselineCommitSha: string,
    scope: readonly string[],
  ): Promise<string[]>;
  readAtRef(
    repoRoot: string,
    ref: string,
    relativePath: string,
  ): Promise<string | null>;
}

interface VcsAdapterOptions {
  repoRoot: string;
}

export function createVcs(options: VcsAdapterOptions): Vcs | Promise<Vcs>;
```

> Метод с именем `isGitRepo` — часть исторического имени контракта; для
> не-git-адаптера читайте его как «является ли это рабочей копией моей VCS?».
> Сохраните имя — `agent-sdd` вызывает его именно по этому имени.

### Справочник методов

| Метод | Должен вернуть | Используется в |
|---|---|---|
| `mechanism` | идентификатор алгоритма фингерпринта, напр. `myvcs_tree_hash_v1` | отражается в JSON `token` / `check` |
| `isGitRepo(cwd)` | `true`, если `cwd` находится внутри рабочей копии, иначе `false` (никогда не бросать исключение) | опциональная проверка baseline в `ready` |
| `repoRoot(cwd)` | корень проекта — каталог, который `agent-sdd` считает репозиторием (см. «Соглашения о путях») | каждая команда |
| `headSha(repoRoot)` | идентификатор текущей головной ревизии в виде строки | `token`, `check`, `refresh` |
| `treeBytes(repoRoot, scope)` | детерминированные байты, снимающие фингерпринт содержимого `scope`; `sha256` от них — это токен | `token`, `check`, `ready` |
| `treePaths(repoRoot, scope)` | каждый путь к файлу под `scope` (относительно repoRoot) | валидация glob-scope |
| `dirtyPaths(repoRoot, scope)` | пути внутри `scope` с незакоммиченными изменениями (относительно repoRoot), отсортированные | `token`, `check`, `refresh` |
| `changedPaths(repoRoot, baseline, scope)` | пути внутри `scope`, изменившиеся между `baseline` и head (относительно repoRoot), отсортированные | `refresh` |
| `readAtRef(repoRoot, ref, path)` | содержимое файла на `ref` или `null`, если путь/ref отсутствует | `ready --against`, `report --against` |

`scope` — это сконфигурированный `discovery_scope`, массив путей/glob'ов
относительно `repoRoot`.

---

## `mechanism`

`mechanism` — это стабильный идентификатор того, **как** ваш адаптер снимает
фингерпринт содержимого. Он должен соответствовать грамматике:

```
^[a-z][a-z0-9_]*$
```

(напр. `git_tree_hash_v1`, `myvcs_content_v1`). Выбирайте значение, отличное от
встроенного `git_tree_hash_v1`, если только ваши байты не являются
по-настоящему git-совместимыми. Относитесь к нему как к версионируемому
контракту: если вы когда-либо измените способ формирования `treeBytes` так, что
это изменит хеш для неизменного содержимого, увеличьте суффикс (`_v2`).
Потребитель задаёт то же значение в поле `mechanism` файла `.sdd/config.json`;
несовпадение — жёсткая ошибка.

---

## Соглашения о путях (та часть, что кусается)

`agent-sdd` работает полностью в путях, **относительных к repoRoot**:
`discovery_scope`, отпечатки IMP в спецификации, путь `spec_file`, пути,
которые возвращают ваши методы, и путь, передаваемый в `readAtRef`, — все они
относительны к тому, что возвращает ваш `repoRoot()`.

Отсюда два правила:

1. **`repoRoot()` должен быть каталогом, который содержит `.sdd/config.json`.**
   `agent-sdd` читает конфиг из `repoRoot/.sdd/config.json` и разрешает
   `discovery_scope` относительно него. Если представление вашей VCS о «корне
   репозитория» отличается от проекта, которым управляет `agent-sdd` (частое в
   монорепозиториях, где один VCS-корень содержит много независимых проектов),
   **не** возвращайте VCS-корень — поднимитесь вверх к ближайшему
   `.sdd/config.json` и верните его.

2. **Нормализуйте пути к относительным к repoRoot на выходе и обратно на
   входе.** Если CLI вашей VCS для некоторых команд печатает пути относительно
   своего собственного корня (а не каталога вашего проекта), убирайте префикс
   проекта из их вывода; если команда (вроде «прочитать файл на ревизии») хочет
   путь относительно VCS-корня, добавляйте префикс перед её вызовом. Держите
   преобразование **пооперационным и однозначным** — вычислите префикс один раз
   (`repoRoot` относительно VCS-корня) и применяйте его детерминированно,
   никогда не угадывая происхождение пути по его строке. Ограничьте
   `discovery_scope` путями внутри проекта, чтобы отображение оставалось
   чистой биекцией.

Проверьте оба правила на **реальной** рабочей копии вашей VCS. Не предполагайте,
что ваша VCS ведёт себя как git: синтаксис команд, то, какие пути принимает
команда, и то, относителен ли вывод к cwd или к корню, — всё это различается, и
ошибка здесь молча приводит к неверным токенам или пустым диффам, а не к
ошибкам.

---

## Обработка ошибок

- `isGitRepo` никогда не бросает исключение — возвращайте `false` при любой
  неудаче.
- `readAtRef` возвращает `null` (а не бросает исключение), когда ref или путь
  отсутствует.
- Остальные методы бросают обычный `Error` с понятным сообщением при неудаче
  (напр. «cli not on PATH», «`<cmd>` failed: <stderr>»). Точное отображение
  кодов выхода в `agent-sdd` (fail-closed форма exit-2) зарезервировано за
  встроенным адаптером; `Error` внешнего адаптера проявляется как ненулевой
  код выхода с вашим сообщением.

Держите каждый вызов **только на чтение**. Адаптер не должен никогда изменять
рабочую копию или историю.

---

## Упаковка

Минимальный пакет-адаптер:

```jsonc
// package.json
{
  "name": "my-vcs-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "engines": { "node": ">=22" },
  "files": ["dist", "README.md"]
}
```

- Никакой рантайм-зависимости от `agent-sdd` — контракт структурный. Скопируйте
  интерфейс `Vcs` локально для проверки типов.
- Поставляйте собранный `dist/`. Загружаются как ESM-, так и CommonJS-пакеты.
- Экспортируйте `createVcs` (именованный предпочтителен; фабрика по умолчанию
  тоже работает).

---

## Настройка потребляющего репозитория

Установите адаптер в репозиторий, содержащий `.sdd/config.json`:

```sh
npm install my-vcs-adapter
```

```jsonc
// .sdd/config.json
{
  "spec_file": "spec/spec.md",
  "baseline_id": "<partition>:BL-001",
  "discovery_scope": ["src", "tests"],
  "vcs": "my-vcs-adapter",
  "mechanism": "myvcs_content_v1"
}
```

---

## Тестирование адаптера

Два уровня:

1. **Соответствие формы** — unit-тест, что `createVcs({ repoRoot })`
   возвращает объект со всеми восемью методами в виде функций и
   грамматически-корректным `mechanism`. Это в точности то, что `agent-sdd`
   проверяет во время загрузки, поэтому такой тест рано ловит дрейф контракта.

2. **Живое поведение** — на реальной рабочей копии вашей VCS вызовите каждый
   метод и проверьте: `repoRoot` — это каталог проекта, `headSha` —
   стабильный идентификатор, `treePaths`/`dirtyPaths`/`changedPaths` относительны
   к repoRoot, `treeBytes`→`sha256` стабилен для неизменного содержимого,
   `readAtRef` возвращает содержимое файла на head. Это единственное место, где
   синтаксис команд и относительность путей действительно доказываются — не
   пропускайте его.

---

## Рабочий скелет

```ts
// src/index.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const MECHANISM = "myvcs_content_v1";

interface Vcs { /* the interface from above */ }

export class MyVcs implements Vcs {
  readonly mechanism = MECHANISM;

  async isGitRepo(cwd: string): Promise<boolean> {
    try { return (await run(cwd, ["is-repo"])).code === 0; }
    catch { return false; }
  }

  // repoRoot = каталог проекта, а не корень VCS: идти вверх до .sdd/config.json
  async repoRoot(cwd: string): Promise<string> {
    let dir = resolve(cwd);
    for (;;) {
      if (existsSync(join(dir, ".sdd", "config.json"))) return dir;
      const up = dirname(dir);
      if (up === dir) throw new Error("no .sdd/config.json above " + cwd);
      dir = up;
    }
  }

  async headSha(repoRoot: string): Promise<string> {
    const r = await run(repoRoot, ["head-id"]);
    if (r.code !== 0) throw new Error("head-id failed: " + r.stderr);
    return r.stdout.toString("utf8").trim();
  }

  // treeBytes / treePaths / dirtyPaths / changedPaths / readAtRef:
  // запустите свой VCS, нормализуйте пути к repoRoot-относительным, верните байты/списки.
}

export function createVcs(_options: { repoRoot: string }): Vcs {
  return new MyVcs();
}
export default { createVcs };

function run(cwd: string, args: string[]) {
  return new Promise<{ code: number; stdout: Buffer; stderr: Buffer }>((res, rej) => {
    const c = spawn("myvcs", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    c.stdout.on("data", (b: Buffer) => out.push(b));
    c.stderr.on("data", (b: Buffer) => err.push(b));
    c.on("error", rej);
    c.on("close", (code) => res({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
  });
}
```

Заполните пять методов, работающих с содержимым, под вашу VCS, докажите их на
реальной рабочей копии — и у вас есть работающий адаптер.
