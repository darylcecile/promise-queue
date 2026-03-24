
type TaskLike<T> = (() => Promise<T>) | Promise<T>;

/**
 * A promise queue that allows you to add promises or functions that return promises, and wait for all of them to complete. 
 * You can also check if any of the promises have errored, and get the results or errors of all the promises.
 */
export class PromiseQueue<T = unknown> {
	#queue: Map<number, TaskLike<T>> = new Map();
	#inc: number = 0;
	#results: PromiseSettledResult<T>[] = [];

	public static from<R = unknown>(tasks: TaskLike<R>[]): PromiseQueue {
		const queue = new PromiseQueue<R>();
		tasks.forEach(task => queue.add(task));
		return queue;
	}

	public add(promise: TaskLike<T>): number {
		const id = this.#inc++;
		this.#queue.set(id, promise);
		return id;
	}

	public remove(id: number): void {
		this.#queue.delete(id);
	}

	public get completed(): Promise<boolean> {
		return new Promise<boolean>(async (resolve) => {
			if (this.#results.length === this.#queue.size) {
				resolve(true);
				return;
			}

			const results = await Promise.allSettled(
				Array
					.from(this.#queue.entries())
					.map(([id, task]) => {
						const promise = typeof task === 'function' ? task() : task;
						this.#queue.set(id, promise);
						return promise;
					})
			);
			
			this.#results = results;
			resolve(this.#results.length === this.#queue.size);
		});
	}

	public get errored(): boolean|null {
		if (this.#results.length === 0) {
			return null;
		}
		return this.#results.some(result => result.status === 'rejected');
	}

	public get results(): Promise<PromiseSettledResult<T>[]> {
		return new Promise<PromiseSettledResult<T>[]>(async (resolve) => {
			await this.completed;
			resolve(this.#results);
		});
	}

	public get errors(): Promise<PromiseRejectedResult[]> {
		return new Promise<PromiseRejectedResult[]>(async (resolve) => {
			if (this.#results.length === 0) {
				resolve([]);
				return;
			}
			const errors = this.#results.filter(result => result.status === 'rejected');
			resolve(errors);
		});
	}
}


type TaskQueueConfig = {
	concurrency?: number;
}

type TaskDefinition<T> = {
	name: string;
	task: () => Promise<T>;
}

type InternalTaskDefinition<T> = Omit<TaskDefinition<T>, 'name'> & { 
	hooks: {
		onComplete: Array<(result: T) => void>;
		onError: Array<(error: any) => void>;
	},
	settleStatus: 'waiting' | 'pending' | 'fulfilled' | 'rejected';
 };

/**
 * A task queue that allows you to add tasks and execute them with a specified concurrency. 
 * Tasks can be added with a name, and you can wait for a task to complete by its name. 
 * You can also pause and resume the queue.
 */
export class TaskQueue {
	#list: Map<string, InternalTaskDefinition<unknown>> = new Map();
	#isPaused: boolean = false;

	constructor(private config:TaskQueueConfig){}

	/**
	 * Adds a task to the queue
	 */
	add<T = unknown>(task: TaskDefinition<T>): void {
		if (this.#list.has(task.name)) {
			throw new Error(`Task with name ${task.name} already exists in the queue`);
		}
		this.#list.set(task.name, {
			...task,
			hooks: {
				onComplete: [],
				onError: []
			},
			settleStatus: 'waiting'
		});
	}

	/**
	 * Adds a task to the queue, returning a promise that resolves when the task is completed
	 */
	addAndWait<T = unknown>(task: TaskDefinition<T>): Promise<T> {
		if (this.#list.has(task.name)) {
			throw new Error(`Task with name ${task.name} already exists in the queue`);
		}
		return new Promise<T>((resolve, reject) => {
			this.#list.set(task.name, {
				...task,
				hooks: { 
					onComplete: [resolve as any],
					onError: [reject as any]
				},
				settleStatus: 'waiting'
			});
		});
	}

	remove(id: string): boolean {
		return this.#list.delete(id);
	}

	/**
	 * Pauses the queue, preventing any new tasks from being executed until the queue is resumed.
	 */
	pause() {
		this.#isPaused = true;
	}

	/**
	 * Resumes the queue, allowing tasks to be executed again.
	 */
	resume() {
		this.#isPaused = false;
		this.start();
	}

	start() {
		if (this.#isPaused) { return; }
		let waitingTasks = Array.from(this.#list.values()).filter(task => task.settleStatus === 'waiting');
		new Promise<void>(async (resolve) => {
			while (waitingTasks.length > 0) {
				if (this.#isPaused) { break; }
				const tasks = waitingTasks.splice(0, this.config.concurrency || 1);
				await Promise.allSettled(
					tasks.map(async (entry) => {
						entry.settleStatus = 'pending';
						try {
							const result = await entry.task();
							entry.settleStatus = 'fulfilled';
							entry.hooks.onComplete.forEach(hook => hook(result));
						} catch (error) {
							entry.settleStatus = 'rejected';
							entry.hooks.onError.forEach(hook => hook(error));
						}
					})
				);
				waitingTasks = Array.from(this.#list.values()).filter(task => task.settleStatus === 'waiting');
			}
			resolve();
		});
	}

	/**
	 * Waits for a task to complete by its name, returning a promise that resolves with the task's result.
	 * This does not trigger the task to run, it only waits for it to complete if it has already been triggered.
	 */
	async waitFor(id: string): Promise<unknown> {
		const task = this.#list.get(id);
		if (!task) {
			throw new Error(`Task with name ${id} does not exist in the queue`);
		}
		task.hooks.onComplete = task.hooks.onComplete || [];
		return new Promise((resolve) => {
			task.hooks.onComplete!.push(resolve);
		});
	}

	get size() {
		return this.#list.size;
	}


}

type RetryableConfig<R> = {
	task: () => Promise<R>;
	onRetryCheck?: (attempt: number, error: any) => Promise<boolean> | boolean;
}

export class Retryable<T = unknown> {
	constructor(private config: RetryableConfig<T>) {}

	async execute(): Promise<T> {
		let attempt = 0;
		while (true) {
			try {
				return await this.config.task();
			} catch (error) {
				attempt++;
				if (this.config.onRetryCheck) {
					const shouldRetry = await this.config.onRetryCheck(attempt, error);
					if (!shouldRetry) {
						throw error;
					}
				} else {
					throw error;
				}
			}
		}
	}
}
