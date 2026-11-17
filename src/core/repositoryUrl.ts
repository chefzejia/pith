/** GitHub repository roots only; file, tree, query and credential URLs are documents. */
export function normalizeRepositoryUrl(input: string): string | null {
  const value = input.trim();
  const match = /^https:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/?$/i.exec(value)
    ?? /^git@github\.com:([a-z0-9_.-]+)\/([a-z0-9_.-]+)\.git$/i.exec(value);
  if (!match) return null;
  const owner = match[1]!, repo = /^git@/i.test(value) ? match[2]! : match[2]!.replace(/\.git$/i, "");
  if (!repo || [owner, repo].some(part => part === "." || part === "..")) return null;
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
