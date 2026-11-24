import type { ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import type { NotifyPriority } from "./config.ts";
import { dispatchNotification } from "./dispatch.ts";
import { heading } from "./message.ts";
import { isRecord, text } from "./payload.ts";
import { folderTitle, isChildProcess, type SessionNotifierDeps } from "./session.ts";
import { fitTelegramBody } from "./recap.ts";

export const PLANNOTATOR_SESSION_OPENED_CHANNEL = "plannotator:session-opened";
export const PLANNOTATOR_SESSION_CLOSED_CHANNEL = "plannotator:session-closed";
export const PLAN_SUBMIT_TOOL = "plannotator_submit_plan";

export interface PlanReviewNotifierDeps extends SessionNotifierDeps {
  onPlanNotified?: () => void;
  env?: NodeJS.ProcessEnv;
}

export interface PlanReviewNotifier {
  onAgentStart(): void;
  onSessionOpened(payload: unknown): void;
  onSessionClosed(payload: unknown): void;
  onToolResult(event: ToolResultEvent): void;
  dispose(): void;
}

interface OpenReview {
  id: string;
  url: string;
  filePath?: string;
  notified: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function inlineCode(value: string): string {
  const cleaned = value.replace(/[\r\n]/g, " ");
  const fence = "`".repeat(Math.max(0, ...(cleaned.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return `${fence} ${cleaned} ${fence}`;
}

function reviewUrl(value: unknown): string | undefined {
  try {
    const url = new URL(text(value));
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    // A malformed extension event is not a review to notify about.
  }
  return undefined;
}

/** Observe Plannotator without importing it or changing its tool results. */
export function createPlanReviewNotifier(
  ctx: ExtensionContext,
  deps: PlanReviewNotifierDeps,
): PlanReviewNotifier {
  let openReview: OpenReview | undefined;
  let openedThisCall = false;
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const handledCalls = new Set<string>();
  const child = isChildProcess(deps.env);
  const dispatch = deps.dispatch ?? dispatchNotification;

  const cancelPending = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    handledCalls.clear();
    openedThisCall = false;
  };

  const isSessionReview = (payload: Record<string, unknown>): boolean => {
    if (payload.action !== "plan-review") return false;
    const sessionId = text(payload.piSessionId);
    return !sessionId || sessionId === ctx.sessionManager.getSessionId();
  };

  const send = (body: string, priority: NotifyPriority, ready = false): void => {
    if (disposed || child) return;
    const config = deps.getConfig();
    if (config.input?.enabled === false) return;
    const title = folderTitle(ctx, deps);
    // Suppress completion before awaiting formatting/transport, not after a slow send.
    if (ready) deps.onPlanNotified?.();
    void fitTelegramBody({ title, text: body, ctx, recap: config.recap })
      .then((message) => {
        if (!disposed) return dispatch({ title, message, priority }, config);
      }).catch(() => {
        // Notifications must never interrupt plan review or approval.
      });
  };

  const notifyReady = (review: OpenReview, filePath: string, version?: unknown): void => {
    review.filePath = filePath;
    review.notified = true;
    const suffix = typeof version === "number" && Number.isSafeInteger(version) && version > 0
      ? ` (v${version})` : "";
    send([
      heading("📝 Plan ready for review", deps.getSessionName?.()),
      "",
      `File: ${inlineCode(filePath)}${suffix}`,
      `Review: <${review.url}> (id ${inlineCode(review.id)})`,
    ].join("\n"), "normal", true);
  };

  return {
    onAgentStart() {
      // Keep the open review for later approval/revision, but never carry delayed
      // finish suppression into a new agent run.
      cancelPending();
    },
    onSessionOpened(payload) {
      if (disposed || child) return;
      const data = record(payload);
      if (!isSessionReview(data)) return;
      const id = text(data.id);
      const url = reviewUrl(data.url);
      if (!id || !url || openReview?.id === id) return;
      openReview = { id, url, notified: false };
      openedThisCall = true;
    },
    onToolResult(event) {
      if (disposed || child || event.toolName !== PLAN_SUBMIT_TOOL) return;
      if (handledCalls.has(event.toolCallId)) return;
      handledCalls.add(event.toolCallId);
      const details = record(event.details);
      const filePath = text(record(event.input).filePath);
      if (event.isError || details.approved !== false || details.unchanged === true
        || details.decisionInFlight === true || !filePath.trim()) {
        openedThisCall = false;
        return;
      }
      if (details.revised === true) {
        openedThisCall = false;
        if (openReview) notifyReady(openReview, filePath, details.version);
        return;
      }

      // The opened event is microtask-delivered by Plannotator. Allow either
      // ordering, but require a fresh opening: approved:false alone also means
      // validation/launch failure. Never parse the tool's human-facing text.
      const reviewAtResult = openReview;
      if (openedThisCall && openReview) openReview.filePath = filePath;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (disposed || !openedThisCall || !openReview || openReview.notified) return;
        if (reviewAtResult && reviewAtResult !== openReview) return;
        openedThisCall = false;
        notifyReady(openReview, filePath);
      }, 0);
      timers.add(timer);
      timer.unref?.();
    },
    onSessionClosed(payload) {
      if (disposed || child) return;
      const data = record(payload);
      if (!isSessionReview(data) || !openReview || data.id !== openReview.id) return;
      const review = openReview;
      openReview = undefined;
      openedThisCall = false;
      if (data.outcome === "approved") {
        const file = review.filePath ? `\n\nFile: ${inlineCode(review.filePath)}` : "";
        send(`${heading("✅ Plan approved", deps.getSessionName?.())}${file}`, "low");
      }
    },
    dispose() {
      disposed = true;
      cancelPending();
      openReview = undefined;
    },
  };
}
