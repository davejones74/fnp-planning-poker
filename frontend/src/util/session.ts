import type { SessionStory, SessionStoryStatus } from "../../../shared/types.ts";

export interface SessionProgress {
  estimated: number;
  total: number;
}

/** Number of stories recorded as estimated versus the whole session backlog. */
export function sessionProgress(stories: SessionStory[]): SessionProgress {
  const total = stories.length;
  const estimated = stories.filter((s) => s.status === "estimated").length;
  return { estimated, total };
}

export function statusLabel(status: SessionStoryStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "estimating":
      return "Estimating";
    case "estimated":
      return "Estimated";
  }
}

/** Formats an ISO timestamp as a short local date + time for the completed list. */
export function formatCompletedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}