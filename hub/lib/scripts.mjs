import { execFile } from 'node:child_process';

function errorResult(error, stderr = '') {
  const detail = String(stderr || error?.message || error || 'Unknown error').trim();
  return { __error: detail || 'Unknown error' };
}

export function runJson(root, script, args = [], timeoutMs = 15000) {
  return new Promise(resolve => {
    try {
      execFile('node', [script, ...args], { cwd: root, timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          resolve(errorResult(error, stderr));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          resolve(errorResult(parseError));
        }
      });
    } catch (error) {
      resolve(errorResult(error));
    }
  });
}

export function getStats(root) {
  return runJson(root, 'stats.mjs');
}

export function getFollowupCadence(root) {
  return runJson(root, 'followup-cadence.mjs');
}

export function getSalaryGap(root) {
  return runJson(root, 'salary-gap.mjs');
}

export function getReposts(root) {
  return runJson(root, 'detect-reposts.mjs');
}
