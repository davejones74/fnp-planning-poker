import { request } from "./rooms.ts";

export interface JiraStory {
  key: string;
  title: string;
  description: string;
  url: string;
}

export interface JiraStatusResult {
  connected: boolean;
  feedUrl: string | null;
}

export interface JiraFeedResult {
  ok: boolean;
  stories: JiraStory[];
  feedUrl: string;
}

export const JIRA_AUTH_REQUIRED = "JIRA_AUTH_REQUIRED";

export const jiraApi = {
  status(code: string, participantId: string): Promise<JiraStatusResult> {
    const query = new URLSearchParams({ code, participantId });
    return request<JiraStatusResult>(`/api/jira/status?${query.toString()}`);
  },

  feed(
    code: string,
    participantId: string,
    feedUrl?: string,
  ): Promise<JiraFeedResult> {
    return request<JiraFeedResult>("/api/jira/feed", {
      method: "POST",
      body: JSON.stringify({ roomCode: code, participantId, feedUrl }),
    });
  },

  authorizeUrl(code: string, returnTo: string): string {
    const query = new URLSearchParams({ room: code, returnTo });
    return `/api/jira/authorize?${query.toString()}`;
  },
};