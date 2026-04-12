import { exec } from 'child_process';

export interface LocalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Execute a command on the local machine via child_process.exec.
 * Returns clean stdout, stderr, and exit code.
 */
export function execLocal(command: string, timeoutMs: number = 30000): Promise<LocalExecResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString().trimEnd(),
        stderr: stderr.toString().trimEnd(),
        exitCode: error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
      });
    });
  });
}
