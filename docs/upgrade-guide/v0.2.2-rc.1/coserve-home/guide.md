---
kind: upgrade-guide
description: "The harness home moves to COSERVE_HOME and ~/.coserve, and the shared agent root to COSERVE_AGENTS_HOME and ~/.coserve-agents."
---

# Harness home environment variables and directories are renamed

English | [中文](guide.zh.md)

## Change

The user-data environment variables and default directories are renamed:

- `DSH_HOME` becomes `COSERVE_HOME`; the default home `~/.dsh` becomes `~/.coserve`.
- `DSH_AGENTS_HOME` becomes `COSERVE_AGENTS_HOME`; the default shared agent root `~/.agents` becomes `~/.coserve-agents`.
- Configuration fields and helpers follow: `dshHome` becomes `coserveHome`, `resolveDshHome` becomes `resolveCoserveHome`, `dshHomePath` becomes `coserveHomePath`, and `dshHomeDisplay` becomes `coserveHomeDisplay`. `resolveAgentsHome` and `agentsHomeDisplay` keep their names.

A process that still exports `DSH_HOME` or `DSH_AGENTS_HOME` receives no override: the harness reads `COSERVE_HOME` and `COSERVE_AGENTS_HOME`, then falls back to the new defaults, so sessions, profiles, credentials, and settings under the old home are not found.

## Migration

1. Rename the variables in shell profiles, service definitions, and launcher scripts: `COSERVE_HOME` replaces `DSH_HOME`, and `COSERVE_AGENTS_HOME` replaces `DSH_AGENTS_HOME`.
2. To keep existing data without copying, point the new variables at the old roots, for example `COSERVE_HOME=$HOME/.dsh` and `COSERVE_AGENTS_HOME=$HOME/.agents`. To move fully, copy `~/.dsh` to `~/.coserve` and `~/.agents` to `~/.coserve-agents`, update scripts that reference the old paths, then unset the overrides so the new defaults apply.
3. In `cordis.yml`, `!!js` expressions and plugin `config` fields that used `dshHome`, `dshHomePath(`, or `resolveDshHome(` must use `coserveHome`, `coserveHomePath(`, and `resolveCoserveHome(`.
4. Update plugins and bundles that declare a `dshHome` config field to `coserveHome`; rebuild or reinstall them so schema validation accepts the new field.
5. Confirm by launching a session and checking that sessions, credentials, and settings resolve under the new home, or by running the recorded workspace-context snapshot fixtures.
