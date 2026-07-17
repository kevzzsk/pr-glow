import { describe, expect, it } from 'vitest';
import { parseRemoteUrl } from '../src/core/remoteParse';

describe('parseRemoteUrl', () => {
  it('parses GitHub https URLs', () => {
    expect(parseRemoteUrl('https://github.com/octocat/hello-world.git')).toEqual({
      kind: 'github',
      host: 'github.com',
      owner: 'octocat',
      repo: 'hello-world',
    });
  });

  it('parses GitHub https URLs without .git suffix', () => {
    expect(parseRemoteUrl('https://github.com/octocat/hello-world')).toMatchObject({
      kind: 'github',
      owner: 'octocat',
      repo: 'hello-world',
    });
  });

  it('parses GitHub scp-like ssh URLs', () => {
    expect(parseRemoteUrl('git@github.com:octocat/hello-world.git')).toEqual({
      kind: 'github',
      host: 'github.com',
      owner: 'octocat',
      repo: 'hello-world',
    });
  });

  it('parses Bitbucket https URLs with embedded username', () => {
    expect(parseRemoteUrl('https://kwol@bitbucket.org/myworkspace/my-repo.git')).toEqual({
      kind: 'bitbucket',
      host: 'bitbucket.org',
      owner: 'myworkspace',
      repo: 'my-repo',
    });
  });

  it('parses Bitbucket scp-like ssh URLs', () => {
    expect(parseRemoteUrl('git@bitbucket.org:myworkspace/my-repo.git')).toEqual({
      kind: 'bitbucket',
      host: 'bitbucket.org',
      owner: 'myworkspace',
      repo: 'my-repo',
    });
  });

  it('parses ssh:// URLs with a port', () => {
    expect(parseRemoteUrl('ssh://git@github.com:22/octocat/hello-world.git')).toMatchObject({
      kind: 'github',
      owner: 'octocat',
      repo: 'hello-world',
    });
  });

  it('classifies GitHub Enterprise hosts when configured', () => {
    expect(parseRemoteUrl('git@github.mycompany.com:team/repo.git', 'github.mycompany.com')).toMatchObject({
      kind: 'github',
      host: 'github.mycompany.com',
      owner: 'team',
      repo: 'repo',
    });
  });

  it('marks unrecognized hosts as unknown', () => {
    expect(parseRemoteUrl('https://gitlab.com/group/project.git')).toMatchObject({
      kind: 'unknown',
      owner: 'group',
      repo: 'project',
    });
  });

  it('handles repo names containing dots', () => {
    expect(parseRemoteUrl('git@github.com:octocat/my.repo.name.git')).toMatchObject({
      repo: 'my.repo.name',
    });
  });

  it('returns undefined for garbage input', () => {
    expect(parseRemoteUrl('')).toBeUndefined();
    expect(parseRemoteUrl('not a url')).toBeUndefined();
    expect(parseRemoteUrl('https://github.com/onlyowner')).toBeUndefined();
  });
});
