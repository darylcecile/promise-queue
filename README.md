# @darylcecile/promise-queue

A promise queue, task queue with concurrency control, and retryable utility for JavaScript/TypeScript.

## Installation

```bash
npm install @darylcecile/promise-queue
```

## API

### `PromiseQueue`

Collects promises or promise-returning functions, settles them all, and gives you structured access to results and errors.

```ts
import { PromiseQueue } from "@darylcecile/promise-queue";

const queue = new PromiseQueue<string>();

queue.add(() => fetch("/api/a").then((r) => r.text()));
queue.add(() => fetch("/api/b").then((r) => r.text()));

await queue.completed;

if (queue.errored) {
  console.error(await queue.errors);
} else {
  console.log(await queue.results);
}
```

You can also create a queue from an existing array of tasks:

```ts
const queue = PromiseQueue.from([
  () => fetch("/api/a").then((r) => r.text()),
  fetch("/api/b").then((r) => r.text()), // raw promises work too
]);
```

| Member      | Type                                   | Description                                                                 |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `add`       | `(task) => number`                     | Adds a promise or promise-returning function. Returns a numeric ID.         |
| `remove`    | `(id: number) => void`                 | Removes a task by ID before it is settled.                                  |
| `completed` | `Promise<boolean>`                     | Resolves `true` once every task has settled.                                |
| `errored`   | `boolean \| null`                      | `true` if any task rejected, `false` if all fulfilled, `null` before settle.|
| `results`   | `Promise<PromiseSettledResult<T>[]>`   | All settled results (fulfilled and rejected).                               |
| `errors`    | `Promise<PromiseRejectedResult[]>`     | Only the rejected results.                                                  |
| `from`      | `static (tasks[]) => PromiseQueue`     | Creates a queue from an array of tasks.                                     |

---

### `TaskQueue`

A concurrency-controlled task queue. Tasks are named, can be individually awaited, and execution can be paused/resumed.

```ts
import { TaskQueue } from "@darylcecile/promise-queue";

const queue = new TaskQueue({ concurrency: 3 });

queue.add({ name: "fetchUsers", task: () => fetchUsers() });
queue.add({ name: "fetchPosts", task: () => fetchPosts() });

queue.start();

const users = await queue.waitFor("fetchUsers");
```

Use `addAndWait` to add a task and get a promise for its result in one step:

```ts
const result = await queue.addAndWait({
  name: "important",
  task: () => doWork(),
});
// queue.start() must be called separately
```

| Member       | Type                              | Description                                                        |
| ------------ | --------------------------------- | ------------------------------------------------------------------ |
| `add`        | `(task) => void`                  | Adds a named task. Throws if the name is already in use.           |
| `addAndWait` | `(task) => Promise<T>`            | Adds a task and returns a promise that resolves with its result.   |
| `remove`     | `(name: string) => boolean`       | Removes a task by name.                                            |
| `start`      | `() => void`                      | Begins executing waiting tasks up to the concurrency limit.        |
| `pause`      | `() => void`                      | Pauses execution; in-flight tasks finish but no new ones start.    |
| `resume`     | `() => void`                      | Resumes execution after a pause.                                   |
| `waitFor`    | `(name: string) => Promise<T>`    | Returns a promise that resolves when the named task completes.     |
| `size`       | `number`                          | The number of tasks in the queue.                                  |

---

### `Retryable`

Wraps an async task with configurable retry logic.

```ts
import { Retryable } from "@darylcecile/promise-queue";

const retryable = new Retryable({
  task: () => fetch("/flaky-endpoint").then((r) => r.json()),
  onRetryCheck: (attempt, error) => {
    console.log(`Attempt ${attempt} failed: ${error.message}`);
    return attempt < 5; // retry up to 5 times
  },
});

const data = await retryable.execute();
```

| Option         | Type                                          | Description                                                              |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `task`         | `() => Promise<T>`                            | The async function to execute.                                           |
| `onRetryCheck` | `(attempt, error) => boolean \| Promise<bool>` | Called on failure. Return `true` to retry, `false` to throw. Optional — if omitted, errors throw immediately. |

## Development

```bash
bun install    # install dependencies
bun test       # run tests
bun run build  # build to dist/
```

## License

MIT
