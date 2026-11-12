import { lstat, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

export async function testSandbox(prefix: string): Promise<string> {
  const root = process.env.PITH_TEST_SANDBOX_ROOT || join(process.cwd(), ".tmp");
  await mkdir(root, { recursive: true });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Expected an existing, non-symlink .tmp directory");
  return mkdtemp(join(root, prefix));
}
