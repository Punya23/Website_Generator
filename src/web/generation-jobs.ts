import type { GenerationResult } from "../types.js";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface GenerationJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: GenerationResult;
}

const jobs = new Map<string, GenerationJob>();
let mutex: Promise<void> = Promise.resolve();

export function createJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getJob(id: string): GenerationJob | undefined {
  return jobs.get(id);
}

export function registerJob(id: string): void {
  jobs.set(id, { id, status: "queued", createdAt: Date.now() });
}

export async function runExclusive<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutex;
  let release!: () => void;
  mutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;

  const job = jobs.get(jobId);
  if (job) {
    job.status = "running";
    job.startedAt = Date.now();
  }

  try {
    return await fn();
  } finally {
    release();
  }
}

export function completeJob(id: string, result: GenerationResult): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "completed";
  job.finishedAt = Date.now();
  job.result = result;
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "failed";
  job.finishedAt = Date.now();
  job.error = error;
}
