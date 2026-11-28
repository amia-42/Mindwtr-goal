# Windows CI and preview builds

The repository keeps exactly one active workflow,
`.github/workflows/windows-ci.yml`. Every other workflow, including the former
desktop release lanes, lives in `.github/workflows-disabled/`, a directory
GitHub does not execute. Restoring a workflow means moving it back into
`.github/workflows/`.

## Triggers

| Event | Condition | Job | Build output |
| --- | --- | --- | --- |
| `pull_request` | target branch `master` or `main` | `verify` | none |
| `push` | tag matching `v*-rc.*` | `preview` | unsigned installers |

The two paths are mutually exclusive. The `preview` job additionally requires
`github.ref` to start with `refs/tags/`.

Consequences:

- Branch pushes build nothing. The workflow has no `push.branches` filter.
- Pull requests compile and test the Rust side (`cargo test` in
  `apps/desktop/src-tauri`) and upload no installer.
- There is no `workflow_dispatch` and no schedule, so the Actions page shows no
  "Run workflow" button. Pushing a tag is the only way to start a preview build.
- A tag name must match `v*-rc.*`. `v1.3.9-rc.1` matches; `v1.3.9` (stable) and
  `v1.3.9-rc1` (missing dot) do not.
- Tag pushes are independent of branches. The workflow has no branch filter for
  tags, and the `preview` guard tests `refs/tags/` only, so a tag pushed from a
  feature branch builds the same way. The job builds the commit the tag points
  at, not the branch tip.

## Pushing a preview tag

```sh
git tag -a v1.3.9-rc.1 -m "Windows preview 1.3.9-rc.1"
git push origin v1.3.9-rc.1
```

Commit first. A tag points at a commit, so uncommitted work is never included.
Creating a name that already exists fails until the old tag is deleted.

Push one explicit tag. `git push --tags` pushes every local tag and can start
unintended builds. `--follow-tags` pushes only annotated tags reachable from the
pushed branch, so a tag created on another branch or on an older commit is
skipped without a warning.

To replace a tag that points at the wrong commit:

```sh
git push origin :refs/tags/v1.3.9-rc.1
git tag -d v1.3.9-rc.1
git tag -a v1.3.9-rc.1 -m "Windows preview 1.3.9-rc.1"
git push origin v1.3.9-rc.1
```

Confirm the remote state with `git ls-remote --tags origin`, then follow the run
under Actions → Windows CI → Windows Preview (unsigned). A release created in the
GitHub UI also creates its tag and can start the same build when that tag is new.

## Preview identity and artifacts

- Version: the tag name without the leading `v`; `v1.3.9-rc.1` becomes
  `1.3.9-rc.1`. It overrides the `version` field of
  `apps/desktop/src-tauri/tauri.conf.json` for that build only, and does not
  rewrite the file. Check the current value in that file before choosing a tag.
- Label: `<version>-preview.<first 7 characters of the tag commit SHA>`.
- Artifact: `windows-preview-<label>`, holding the portable
  `mindwtr_<label>_x64.exe`, a zip of it, and the NSIS `*-setup.exe` installer.
  Retention is 14 days, and a missing file fails the job.
- Runner: `windows-2022`, 60-minute timeout. Dependencies install with
  `bun install --frozen-lockfile`, retried once after clearing the Bun cache.
  `bunx tauri build` then runs its `beforeBuildCommand` (`tsc && vite build`), so
  type errors fail the build before packaging.
- CPU flags are pinned off (`GGML_NATIVE`, `GGML_AVX2`, `GGML_FMA`,
  `GGML_F16C`, `GGML_BMI2`) so the binaries are not limited to newer processors.
- The packages are unsigned and unpublished: no signing, no notarization, no
  Release, and the workflow holds `contents: read` only. Windows SmartScreen
  warns on first launch.
- Concurrency is grouped by `github.ref_name`, and a tag build does not cancel
  another run.

## Where it builds

Tags are pushed to `origin`. In a fork checkout the run happens in that fork's
Actions, using that repository's quota and permissions, and the artifacts
download from that fork's run page. Building in the upstream repository requires
its own remote and a separate push; the tag exists only on the remote that
received it.
