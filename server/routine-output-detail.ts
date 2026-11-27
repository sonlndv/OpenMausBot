import { redactSecretsInText } from "../shared/redact.ts";
import { clipRunOutput } from "./routine-lines.ts";
import type { RoutineRun } from "./routines.ts";
import type { Message } from "./store.ts";

type OutputRun = Pick<RoutineRun, "id" | "report" | "resultsThreadId" | "output" | "target" | "threadId" | "startedAt" | "finishedAt">;
type OutputMessage = Pick<Message, "id" | "at" | "role" | "kind" | "text" | "automation" | "attachments">;

export function routineOutputDetail(run: OutputRun, messages: (threadId: string) => readonly OutputMessage[]) {
  const report = run.report;
  if (report?.state === "posted" && report.threadId === run.resultsThreadId && report.threadId) {
    const line = messages(report.threadId).find((message) => message.id === report.messageId);
    if (line?.role === "bot" && line.kind === "text" && line.automation?.runId === run.id && !line.automation.copyOf) {
      const output = redactSecretsInText(line.text ?? "");
      const partial = line.automation.partial ? executionOutput(run, messages) : undefined;
      return {
        output,
        ...(partial && partial !== output ? { partialOutput: partial } : {}),
        ...(line.attachments?.length ? { attachments: line.attachments } : {}),
      };
    }
  }
  return { output: executionOutput(run, messages) };
}

function executionOutput(run: OutputRun, messages: (threadId: string) => readonly OutputMessage[]): string | undefined {
  if (!run.output || run.target !== "bot" || !run.threadId || run.startedAt === undefined) return run.output;
  const startedAt = run.startedAt;
  let full: string | undefined;
  for (const line of messages(run.threadId)) {
    if (line.at < startedAt || (run.finishedAt !== undefined && line.at > run.finishedAt) ||
        line.role !== "bot" || line.kind !== "text" || !line.text || line.automation) continue;
    const text = redactSecretsInText(line.text).trim();
    if (clipRunOutput(text, 2_000) !== run.output) continue;
    if (full !== undefined && full !== text) return run.output;
    full = text;
  }
  return full ?? run.output;
}
