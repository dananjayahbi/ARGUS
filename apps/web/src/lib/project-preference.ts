export const ACTIVE_PROJECT_STORAGE_KEY = "argus.activeProject";

export function resolveStoredProjectKey(
  stored: string | null,
  projectKeys: string[],
): string | null {
  if (!stored) {
    return null;
  }

  return projectKeys.includes(stored) ? stored : null;
}

/**
 * Resolve the project to open on a bare /dashboard visit.
 * A valid stored key wins; otherwise the first project is the fallback.
 * Returns null when there are no accessible projects.
 */
export function resolveDashboardProjectKey(
  stored: string | null,
  projectKeys: string[],
): string | null {
  if (projectKeys.length === 0) {
    return null;
  }

  return resolveStoredProjectKey(stored, projectKeys) ?? projectKeys[0];
}
