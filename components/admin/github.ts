// 관리 화면 ↔ GitHub 저장소: data/corrections.json을 읽고 커밋한다. 커밋되면 GitHub Actions가 사이트를 다시 배포한다.
// 토큰: GitHub fine-grained token(이 저장소만, Contents 읽기·쓰기 + Actions 읽기). 이 브라우저에만 저장된다.
import { EMPTY_CORRECTIONS, type Corrections } from '@/lib/corrections';

export const CORRECTIONS_PATH = 'data/corrections.json';
const API = 'https://api.github.com';

export interface GitHubConfig { repo: string; token: string; branch: string }
export class GitHubError extends Error { constructor(message: string, public status: number) { super(message); } }

async function call<T>(config: GitHubConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) {
    const messages: Record<number, string> = { 401: '토큰이 올바르지 않거나 만료되었어요.', 403: '토큰 권한이 부족해요. 이 저장소의 Contents 쓰기 권한이 필요해요.', 404: '저장소나 파일을 찾지 못했어요. 저장소 이름과 토큰 권한을 확인해 주세요.', 409: '다른 사람이 먼저 저장했어요. 최신 내용을 다시 불러온 뒤 저장해 주세요.', 422: '저장 요청이 거절됐어요. 최신 내용을 다시 불러와 주세요.' };
    throw new GitHubError(messages[response.status] ?? `GitHub 오류 ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

const decode = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\n/g, '')), (char) => char.charCodeAt(0)));
const encode = (text: string) => { const bytes = new TextEncoder().encode(text); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); };

// 연결 확인: 저장소 접근과 쓰기 권한
export async function checkAccess(config: GitHubConfig): Promise<{ canWrite: boolean; fullName: string }> {
  const repo = await call<{ full_name: string; permissions?: { push?: boolean } }>(config, `/repos/${config.repo}`);
  return { canWrite: !!repo.permissions?.push, fullName: repo.full_name };
}

export async function loadCorrections(config: GitHubConfig): Promise<{ corrections: Corrections; sha: string | null }> {
  try {
    const file = await call<{ content: string; sha: string }>(config, `/repos/${config.repo}/contents/${CORRECTIONS_PATH}?ref=${config.branch}`);
    return { corrections: { ...EMPTY_CORRECTIONS, ...JSON.parse(decode(file.content)) }, sha: file.sha };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return { corrections: { ...EMPTY_CORRECTIONS }, sha: null };
    throw error;
  }
}

export async function saveCorrections(config: GitHubConfig, corrections: Corrections, sha: string | null, message: string): Promise<{ sha: string; commitSha: string; commitUrl: string }> {
  const body = { message, content: encode(JSON.stringify(corrections, null, 2) + '\n'), branch: config.branch, ...(sha ? { sha } : {}) };
  const result = await call<{ content: { sha: string }; commit: { sha: string; html_url: string } }>(config, `/repos/${config.repo}/contents/${CORRECTIONS_PATH}`, { method: 'PUT', body: JSON.stringify(body) });
  return { sha: result.content.sha, commitSha: result.commit.sha, commitUrl: result.commit.html_url };
}

// 저장 커밋의 배포(GitHub Actions) 상태. 권한이 없으면 null.
export async function deployStatus(config: GitHubConfig, commitSha: string): Promise<{ status: string; conclusion: string | null; url: string } | null> {
  try {
    const runs = await call<{ workflow_runs: { status: string; conclusion: string | null; html_url: string }[] }>(config, `/repos/${config.repo}/actions/runs?head_sha=${commitSha}&per_page=1`);
    const run = runs.workflow_runs[0];
    return run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : { status: 'queued', conclusion: null, url: '' };
  } catch { return null; }
}
