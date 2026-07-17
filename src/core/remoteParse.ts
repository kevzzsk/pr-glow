export type ProviderKind = 'github' | 'bitbucket' | 'unknown';

export interface ParsedRemote {
  kind: ProviderKind;
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL (https, ssh scp-like, or ssh://) into host/owner/repo
 * and classify the hosting provider.
 *
 * Supported forms:
 *   https://github.com/owner/repo.git
 *   https://user@bitbucket.org/workspace/repo.git
 *   git@github.com:owner/repo.git
 *   ssh://git@bitbucket.org/workspace/repo.git
 *   ssh://git@github.mycompany.com:2222/owner/repo.git
 */
export function parseRemoteUrl(url: string, githubEnterpriseHost?: string): ParsedRemote | undefined {
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  let host = '';
  let path = '';

  const schemeMatch = /^(https?|ssh|git):\/\/(?:([^@/]+)@)?([^/:]+)(?::(\d+))?\/(.+)$/.exec(trimmed);
  const scpMatch = /^(?:([^@/]+)@)?([^:/]+):(?!\/\/)(.+)$/.exec(trimmed);

  if (schemeMatch) {
    host = schemeMatch[3];
    path = schemeMatch[5];
  } else if (scpMatch) {
    host = scpMatch[2];
    path = scpMatch[3];
  } else {
    return undefined;
  }

  path = path.replace(/\.git$/, '').replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) {
    return undefined;
  }
  // owner/repo are the last two segments (handles hosts that prefix paths, e.g. /scm/ on some servers)
  const owner = segments[segments.length - 2];
  const repo = segments[segments.length - 1];

  const lowerHost = host.toLowerCase();
  let kind: ProviderKind = 'unknown';
  if (lowerHost === 'github.com' || lowerHost === 'www.github.com') {
    kind = 'github';
  } else if (lowerHost === 'bitbucket.org') {
    kind = 'bitbucket';
  } else if (githubEnterpriseHost && lowerHost === githubEnterpriseHost.toLowerCase()) {
    kind = 'github';
  }

  return { kind, host, owner, repo };
}
