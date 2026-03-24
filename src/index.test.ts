import { describe, it, expect } from "bun:test";
import { PromiseQueue, TaskQueue, Retryable } from './index';

// Helper to create a delayed resolved promise
const delayed = <T>(ms: number, value: T) =>
	() => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

// Helper to create a delayed rejected promise
const delayedReject = (ms: number, error: string) =>
	() => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(error)), ms));

describe("PromiseQueue", () => {
	describe("add", () => {
		it("returns incrementing ids starting from 0", () => {
			const queue = new PromiseQueue();
			expect(queue.add(delayed(1, "a"))).toBe(0);
			expect(queue.add(delayed(1, "b"))).toBe(1);
			expect(queue.add(delayed(1, "c"))).toBe(2);
		});

		it("accepts both promise functions and raw promises", () => {
			const queue = new PromiseQueue<string>();
			const id1 = queue.add(delayed(1, "fn"));
			const id2 = queue.add(Promise.resolve("raw"));
			expect(id1).toBe(0);
			expect(id2).toBe(1);
		});
	});

	describe("remove", () => {
		it("removes a task by id so it is not executed", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			const id = queue.add(delayed(1, "b"));
			queue.remove(id);
			await queue.completed;
			const results = await queue.results;
			expect(results).toHaveLength(1);
			expect((results[0] as PromiseFulfilledResult<string>).value).toBe("a");
		});
	});

	describe("completed", () => {
		it("resolves to true when all tasks complete successfully", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			queue.add(delayed(1, "b"));
			const result = await queue.completed;
			expect(result).toBe(true);
		});

		it("resolves to true even when some tasks reject", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			queue.add(delayedReject(1, "fail"));
			const result = await queue.completed;
			expect(result).toBe(true);
		});

		it("resolves to true for an empty queue", async () => {
			const queue = new PromiseQueue();
			const result = await queue.completed;
			expect(result).toBe(true);
		});
	});

	describe("errored", () => {
		it("returns null before any tasks have been settled", () => {
			const queue = new PromiseQueue();
			queue.add(delayed(10, "a"));
			expect(queue.errored).toBeNull();
		});

		it("returns false when all tasks succeed", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			queue.add(delayed(1, "b"));
			await queue.completed;
			expect(queue.errored).toBe(false);
		});

		it("returns true when at least one task rejects", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			queue.add(delayedReject(1, "boom"));
			await queue.completed;
			expect(queue.errored).toBe(true);
		});
	});

	describe("results", () => {
		it("returns all settled results after completion", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			queue.add(delayed(1, "b"));
			const results = await queue.results;
			expect(results).toHaveLength(2);
			expect(results.every(r => r.status === "fulfilled")).toBe(true);
			const values = results.map(r => (r as PromiseFulfilledResult<string>).value);
			expect(values).toContain("a");
			expect(values).toContain("b");
		});

		it("includes both fulfilled and rejected results", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "ok"));
			queue.add(delayedReject(1, "err"));
			const results = await queue.results;
			expect(results).toHaveLength(2);
			expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
			expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
		});
	});

	describe("errors", () => {
		it("returns only rejected results", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "ok"));
			queue.add(delayedReject(1, "err1"));
			queue.add(delayedReject(1, "err2"));
			await queue.completed;
			const errors = await queue.errors;
			expect(errors).toHaveLength(2);
			expect(errors.every(e => e.status === "rejected")).toBe(true);
		});

		it("returns empty array when no errors", async () => {
			const queue = new PromiseQueue<string>();
			queue.add(delayed(1, "a"));
			await queue.completed;
			const errors = await queue.errors;
			expect(errors).toHaveLength(0);
		});
	});

	describe("from", () => {
		it("creates a queue from an array of tasks", async () => {
			const queue = PromiseQueue.from([
				delayed(1, "a"),
				delayed(1, "b"),
				delayed(1, "c"),
			]);
			const results = await queue.results;
			expect(results).toHaveLength(3);
		});

		it("creates a queue from raw promises", async () => {
			const queue = PromiseQueue.from([
				Promise.resolve("x"),
				Promise.resolve("y"),
			]);
			const results = await queue.results;
			expect(results).toHaveLength(2);
		});
	});
});

describe("TaskQueue", () => {
	describe("add", () => {
		it("adds a task to the queue", () => {
			const queue = new TaskQueue({ concurrency: 1 });
			queue.add({ name: "task1", task: delayed(1, "a") });
			expect(queue.size).toBe(1);
		});

		it("throws if a task with the same name already exists", () => {
			const queue = new TaskQueue({ concurrency: 1 });
			queue.add({ name: "task1", task: delayed(1, "a") });
			expect(() => queue.add({ name: "task1", task: delayed(1, "b") }))
				.toThrow("Task with name task1 already exists in the queue");
		});
	});

	describe("remove", () => {
		it("removes a task by name", () => {
			const queue = new TaskQueue({ concurrency: 1 });
			queue.add({ name: "task1", task: delayed(1, "a") });
			expect(queue.remove("task1")).toBe(true);
			expect(queue.size).toBe(0);
		});

		it("returns false if task does not exist", () => {
			const queue = new TaskQueue({ concurrency: 1 });
			expect(queue.remove("nonexistent")).toBe(false);
		});
	});

	describe("size", () => {
		it("reflects the number of tasks in the queue", () => {
			const queue = new TaskQueue({ concurrency: 1 });
			expect(queue.size).toBe(0);
			queue.add({ name: "a", task: delayed(1, 1) });
			queue.add({ name: "b", task: delayed(1, 2) });
			expect(queue.size).toBe(2);
			queue.remove("a");
			expect(queue.size).toBe(1);
		});
	});

	describe("start", () => {
		it("executes all waiting tasks", async () => {
			const results: string[] = [];
			const queue = new TaskQueue({ concurrency: 10 });
			queue.add({ name: "a", task: async () => { results.push("a"); return "a"; } });
			queue.add({ name: "b", task: async () => { results.push("b"); return "b"; } });
			queue.start();
			// Wait for tasks to finish
			await new Promise(r => setTimeout(r, 50));
			expect(results).toContain("a");
			expect(results).toContain("b");
		});

		it("respects concurrency limit", async () => {
			let concurrent = 0;
			let maxConcurrent = 0;

			const makeTask = (name: string) => ({
				name,
				task: async () => {
					concurrent++;
					maxConcurrent = Math.max(maxConcurrent, concurrent);
					await new Promise(r => setTimeout(r, 30));
					concurrent--;
					return name;
				},
			});

			const queue = new TaskQueue({ concurrency: 2 });
			queue.add(makeTask("a"));
			queue.add(makeTask("b"));
			queue.add(makeTask("c"));
			queue.add(makeTask("d"));
			queue.start();
			await new Promise(r => setTimeout(r, 200));
			expect(maxConcurrent).toBe(2);
		});

		it("does nothing when paused", async () => {
			const results: string[] = [];
			const queue = new TaskQueue({ concurrency: 1 });
			queue.add({ name: "a", task: async () => { results.push("a"); return "a"; } });
			queue.pause();
			queue.start();
			await new Promise(r => setTimeout(r, 50));
			expect(results).toHaveLength(0);
		});
	});

	describe("addAndWait", () => {
		it("resolves with the task result once executed", async () => {
			const queue = new TaskQueue({ concurrency: 1 });
			const promise = queue.addAndWait({ name: "task1", task: async () => 42 });
			queue.start();
			const result = await promise;
			expect(result).toBe(42);
		});

		it("rejects if the task throws", async () => {
			const queue = new TaskQueue({ concurrency: 1 });
			const promise = queue.addAndWait({
				name: "fail",
				task: async () => { throw new Error("task error"); },
			});
			queue.start();
			await expect(promise).rejects.toThrow("task error");
		});

		it("throws if a task with the same name already exists", () => {
			const queue = new TaskQueue({ concurrency: 1 });
			queue.add({ name: "task1", task: delayed(1, "a") });
			expect(() => queue.addAndWait({ name: "task1", task: delayed(1, "b") }))
				.toThrow("Task with name task1 already exists in the queue");
		});
	});

	describe("pause and resume", () => {
		it("pauses and resumes task execution", async () => {
			const results: string[] = [];
			const queue = new TaskQueue({ concurrency: 1 });

			queue.add({ name: "a", task: async () => { results.push("a"); return "a"; } });
			queue.add({ name: "b", task: async () => { results.push("b"); return "b"; } });

			queue.pause();
			queue.start();
			await new Promise(r => setTimeout(r, 50));
			expect(results).toHaveLength(0);

			queue.resume();
			await new Promise(r => setTimeout(r, 50));
			expect(results).toContain("a");
			expect(results).toContain("b");
		});
	});

	describe("waitFor", () => {
		it("resolves when the named task completes", async () => {
			const queue = new TaskQueue({ concurrency: 1 });
			queue.add({ name: "slow", task: async () => { await new Promise(r => setTimeout(r, 20)); return "done"; } });
			queue.start();
			const result = await queue.waitFor("slow");
			expect(result).toBe("done");
		});

		it("throws if the task does not exist", async () => {
			const queue = new TaskQueue({ concurrency: 1 });
			expect(() => queue.waitFor("ghost")).toThrow("Task with name ghost does not exist in the queue");
		});
	});
});

describe("Retryable", () => {
	it("succeeds on the first attempt", async () => {
		const retryable = new Retryable({ task: async () => "ok" });
		const result = await retryable.execute();
		expect(result).toBe("ok");
	});

	it("throws immediately without onRetryCheck", async () => {
		const retryable = new Retryable({
			task: async () => { throw new Error("fail"); },
		});
		await expect(retryable.execute()).rejects.toThrow("fail");
	});

	it("retries when onRetryCheck returns true", async () => {
		let attempts = 0;
		const retryable = new Retryable({
			task: async () => {
				attempts++;
				if (attempts < 3) throw new Error("not yet");
				return "success";
			},
			onRetryCheck: () => true,
		});
		const result = await retryable.execute();
		expect(result).toBe("success");
		expect(attempts).toBe(3);
	});

	it("stops retrying when onRetryCheck returns false", async () => {
		let attempts = 0;
		const retryable = new Retryable({
			task: async () => {
				attempts++;
				throw new Error("always fail");
			},
			onRetryCheck: (attempt) => attempt < 3,
		});
		await expect(retryable.execute()).rejects.toThrow("always fail");
		expect(attempts).toBe(3);
	});

	it("passes attempt count and error to onRetryCheck", async () => {
		const receivedAttempts: number[] = [];
		const receivedErrors: string[] = [];
		const retryable = new Retryable({
			task: async () => { throw new Error("oops"); },
			onRetryCheck: (attempt, error) => {
				receivedAttempts.push(attempt);
				receivedErrors.push(error.message);
				return attempt < 2;
			},
		});
		await expect(retryable.execute()).rejects.toThrow("oops");
		expect(receivedAttempts).toEqual([1, 2]);
		expect(receivedErrors).toEqual(["oops", "oops"]);
	});

	it("supports async onRetryCheck", async () => {
		let attempts = 0;
		const retryable = new Retryable({
			task: async () => {
				attempts++;
				if (attempts < 2) throw new Error("retry me");
				return "done";
			},
			onRetryCheck: async () => {
				await new Promise(r => setTimeout(r, 5));
				return true;
			},
		});
		const result = await retryable.execute();
		expect(result).toBe("done");
		expect(attempts).toBe(2);
	});
});