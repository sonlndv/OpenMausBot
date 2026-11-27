import { RESULTS_NEW_THREAD } from "../shared/routines.ts";
import { cloneAttachments } from "./routine-attachments.ts";
import type { Routine, RoutineInput, RoutineManagerOptions, RoutineRun } from "./routines.ts";

export type ResultsThreadAllocation = { botId: string; threadId: string };

/** Applies a saved destination choice to `routine`; returns how a failed save discards a thread the choice just opened. */
export function applyResultsInput(
  routine: Routine,
  value: RoutineInput["resultsThreadId"],
  options: Pick<RoutineManagerOptions, "resolveResultsThread" | "createResultsThread" | "discardResultsThread" | "isResultsThread">,
): (() => void) | undefined {
  if (routine.target !== "bot") {
    if (value != null) throw Object.assign(new Error("Results threads are only available for bot routines"), { status: 400 });
    delete routine.resultsThreadId;
    return;
  }
  if (value === undefined) return;
  if (value === null) {
    const destination = options.resolveResultsThread?.(routine, true);
    if (!destination || destination.main) {
      delete routine.resultsThreadId;
      return;
    }
    routine.resultsThreadId = destination.threadId;
    return () => options.discardResultsThread?.(routine.botId, destination.threadId);
  }
  if (value === RESULTS_NEW_THREAD) {
    const threadId = options.createResultsThread?.(routine);
    if (!threadId) throw Object.assign(new Error("A new results thread is not available here. Choose another destination."), { status: 400 });
    routine.resultsThreadId = threadId;
    return () => options.discardResultsThread?.(routine.botId, threadId);
  }
  if (typeof value !== "string" || !value.trim() || !options.isResultsThread?.(routine.botId, value.trim())) {
    throw Object.assign(new Error("Choose a visible results thread belonging to this bot"), { status: 400 });
  }
  routine.resultsThreadId = value.trim();
  return;
}

export function resolveRoutineResultsThread(
  routine: Routine,
  resolve: RoutineManagerOptions["resolveResultsThread"],
  allocations: ResultsThreadAllocation[],
  now: number,
  sourceThreadId = routine.sourceThreadId,
): string | undefined {
  if (routine.target !== "bot" || !resolve) return routine.resultsThreadId;
  const destination = resolve({ ...routine, sourceThreadId }, false);
  // An explicitly chosen chat that is gone stays chosen: the run reports to the fallback, the pin is never rewritten.
  if (destination?.pinnedMissing) return destination.threadId;
  const own = destination?.main ? undefined : destination?.threadId;
  if (own !== routine.resultsThreadId) {
    if (own) allocations.push({ botId: routine.botId, threadId: own });
    if (own) routine.resultsThreadId = own;
    else delete routine.resultsThreadId;
    routine.updatedAt = Math.max(now, routine.updatedAt + 1);
  }
  return destination?.threadId;
}

export function routineRunDefinition(routine: Routine): Pick<RoutineRun,
  "routineName" | "prompt" | "durationMinutes" | "timeoutMinutes" | "attachments" | "target" | "groupId" | "botId" | "runOn" | "access" | "deliver" | "sameConversation"> {
  return {
    routineName: routine.name,
    prompt: routine.prompt,
    durationMinutes: routine.durationMinutes,
    ...(routine.timeoutMinutes === undefined ? {} : { timeoutMinutes: routine.timeoutMinutes }),
    attachments: cloneAttachments(routine.attachments),
    target: routine.target,
    groupId: routine.groupId,
    botId: routine.botId,
    runOn: routine.runOn ?? "maus",
    access: routine.access,
    deliver: routine.deliver,
    sameConversation: routine.sameConversation ? true : undefined,
  };
}
