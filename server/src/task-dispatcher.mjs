import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

function taskId(workspaceId, runId) {
  return `brand-search-${createHash("sha256").update(`${workspaceId}:${runId}`).digest("hex").slice(0, 32)}`;
}

function isAlreadyExists(error) {
  return error?.code === 6 || error?.code === "ALREADY_EXISTS";
}

export function createTaskDispatcher({ client, projectId, location, queue, workerUrl, serviceAccountEmail, audience = workerUrl }) {
  if (!client || !projectId || !location || !queue || !workerUrl || !serviceAccountEmail) throw new Error("Task dispatcher configuration is incomplete");
  const parent = `projects/${projectId}/locations/${location}/queues/${queue}`;
  return {
    async dispatch({ workspaceId, runId }) {
      if (!idPattern.test(workspaceId) || !idPattern.test(runId)) throw new ApiError("INVALID_INPUT", "작업 식별자가 올바르지 않습니다.");
      const name = `${parent}/tasks/${taskId(workspaceId, runId)}`;
      try {
        await client.createTask({
          parent,
          task: {
            name,
            httpRequest: {
              httpMethod: "POST",
              url: `${workerUrl}/internal/v1/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}:execute`,
              headers: { "content-type": "application/json" },
              oidcToken: { serviceAccountEmail, audience }
            }
          }
        });
        return { taskName: name, reused: false };
      } catch (error) {
        if (isAlreadyExists(error)) return { taskName: name, reused: true };
        throw new ApiError("TASK_DISPATCH_FAILED", "작업을 예약하지 못했습니다. 같은 요청으로 다시 시도해주세요.", 503);
      }
    }
  };
}
