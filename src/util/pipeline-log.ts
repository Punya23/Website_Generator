type LogListener = (line: string) => void;

const listeners = new Set<LogListener>();

export function pipelineLog(message: string): void {
  const line = message.endsWith("\n") ? message.slice(0, -1) : message;
  console.log(line);
  for (const listener of listeners) listener(line);
}

export function subscribePipelineLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
