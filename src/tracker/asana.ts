/**
 * Filing a review comment as an Asana task.
 *
 * One POST, authenticated with a personal access token, into a project the
 * person names by its identifier. Asana's own URLs carry that identifier, so
 * naming the project is a copy and a paste rather than a lookup.
 *
 * Two things are deliberately absent. **Tags**, which are the nearest thing
 * Asana has to a label, are objects with identifiers of their own: offering
 * them would mean asking for a second set of numbers for something nobody
 * asked for. And **custom fields**, where a priority would have to live,
 * differ per workspace -- there is no field to set that is there for
 * everyone. The priority is in the task's body instead, where it is at least
 * true everywhere.
 */

import { FiledIssue, TrackerError, trackerRequest } from "./request";

const API = "https://app.asana.com/api/1.0";

export interface AsanaConfig {
  token: string;
  /** Project gid tasks are created in. */
  project: string;
  /** Workspace gid. Optional: a project already implies one. */
  workspace: string;
}

export class AsanaClient {
  constructor(private readonly config: AsanaConfig) {}

  async createTask(options: { name: string; notes: string }): Promise<FiledIssue> {
    const created = await trackerRequest<{
      data?: { gid?: string; permalink_url?: string };
    }>({
      url: `${API}/tasks`,
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.token}` },
      body: {
        data: {
          name: options.name,
          notes: options.notes,
          projects: [this.config.project],
          // Sent only when it was given: Asana works out the workspace from
          // the project, and a wrong one is a refusal rather than a hint.
          ...(this.config.workspace ? { workspace: this.config.workspace } : {}),
        },
      },
    });

    const gid = created.data?.gid;
    if (!gid) {
      throw new TrackerError("Asana created the task but did not say which.", 0);
    }

    return {
      // A task has no short key the way an issue number or a Jira key is
      // one, so what gets written down is the identifier Asana itself uses.
      key: `Asana task ${gid}`,
      url: created.data?.permalink_url || `${API.replace("/api/1.0", "")}/0/0/${gid}`,
    };
  }

  /**
   * Ticks one task off.
   *
   * There is no "closed for another reason" here: a task is completed or it
   * is not, and Asana offers nothing else to say about it.
   */
  async completeTask(gid: string): Promise<void> {
    await trackerRequest({
      url: `${API}/tasks/${encodeURIComponent(gid)}`,
      method: "PUT",
      headers: { Authorization: `Bearer ${this.config.token}` },
      body: { data: { completed: true } },
    });
  }

  /**
   * Whether one task is ticked off.
   *
   * `completed` is the whole of what Asana has to say about it: a task
   * carries no resolution and no reason, so there is nothing else to ask
   * for and no half-done state to interpret.
   */
  async taskStatus(gid: string): Promise<{ completed: boolean }> {
    const task = await trackerRequest<{ data?: { completed?: boolean } }>({
      url: `${API}/tasks/${encodeURIComponent(gid)}?opt_fields=completed`,
      method: "GET",
      headers: { Authorization: `Bearer ${this.config.token}` },
    });

    return { completed: task.data?.completed === true };
  }
}
