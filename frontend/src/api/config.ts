import { request } from "./rooms.ts";

export interface ClientConfig {
  jiraHost: string | null;
  jiraProjectKey: string | null;
}

export const configApi = {
  client(): Promise<ClientConfig> {
    return request<ClientConfig>("/api/config");
  },
};