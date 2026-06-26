type LogListener = (line: string) => void;

const listeners = new Set<LogListener>();

export interface PipelineContext {
  jobId?: string;
  profileId?: string;
  seed?: number;
}

let pipelineContext: PipelineContext = {};

export interface StructuredPipelineEvent {
  type: "pipeline";
  jobId?: string;
  step?: string;
  scope?: string;
  durationMs?: number;
  profileId?: string;
  seed?: number;
  error?: string;
  message?: string;
  tokens?: { prompt: number; completion: number; total: number };
  fallbacks?: Record<string, number>;
}

export function setPipelineContext(ctx: PipelineContext): void {
  pipelineContext = { ...ctx };
}

export function clearPipelineContext(): void {
  pipelineContext = {};
}

export function pipelineLog(message: string): void {
  const line = message.endsWith("\n") ? message.slice(0, -1) : message;
  console.log(line);
  for (const listener of listeners) listener(line);
}

export function pipelineStructured(event: Omit<StructuredPipelineEvent, "type">): void {
  const payload: StructuredPipelineEvent = {
    type: "pipeline",
    jobId: event.jobId ?? pipelineContext.jobId,
    profileId: event.profileId ?? pipelineContext.profileId,
    seed: event.seed ?? pipelineContext.seed,
    ...event,
  };
  const line = JSON.stringify(payload);
  if (process.env.PIPELINE_JSON_LOG === "1") {
    console.log(line);
  }
  for (const listener of listeners) listener(line);
}

export function subscribePipelineLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
