import { describe, expect, it } from "vitest";
import { routineOutputDetail } from "./routine-output-detail.ts";

const summary = "a".repeat(2_000);
const run = { id: "second", target: "bot" as const, threadId: "shared", startedAt: 20, finishedAt: 30, output: summary };
const line = (at: number, text: string) => ({ id: String(at), at, text, role: "bot" as const, kind: "text" as const });

describe("opening a run's output", () => {
  it("expands the matching reply inside the selected run, even when another run starts the same way", () => {
    const output = routineOutputDetail(run, () => [line(10, summary + " first"), line(22, summary + " second"), line(40, summary + " later")]);
    expect(output.output).toBe(summary + " second");
  });

  it("keeps the saved result when a legacy transcript has two indistinguishable replies", () => {
    expect(routineOutputDetail(run, () => [line(21, summary + " one"), line(23, summary + " two")]).output).toBe(summary);
    expect(routineOutputDetail(run, () => []).output).toBe(summary);
  });

  it("uses the posted report only when its message belongs to this run", () => {
    const posted = { ...run, resultsThreadId: "work", report: { state: "posted" as const, threadId: "work", messageId: "22" } };
    const report = { ...line(22, "Full report"), automation: { routineId: "job", runId: "second", name: "Brief", trigger: "schedule" as const, executionThreadId: "shared", scheduledFor: 20 } };
    expect(routineOutputDetail(posted, (id) => id === "work" ? [report] : []).output).toBe("Full report");
    const files = { ...report, text: "", attachments: [{ kind: "file" as const, name: "brief.pdf", mime: "application/pdf", path: "/brief" }] };
    expect(routineOutputDetail(posted, () => [files])).toEqual({ output: "", attachments: files.attachments });
    const recovered = { ...report, text: "Reporting normally again.", automation: { ...report.automation, recovered: true as const } };
    expect(routineOutputDetail(posted, () => [recovered]).output).toBe(recovered.text);
    const partial = { ...report, text: "Stopped early.", automation: { ...report.automation, failed: true as const, partial: true as const } };
    expect(routineOutputDetail(posted, () => [partial])).toEqual({ output: partial.text, partialOutput: summary });
    expect(routineOutputDetail({ ...posted, id: "other" }, (id) => id === "work" ? [report] : []).output).toBe(summary);
  });
});
