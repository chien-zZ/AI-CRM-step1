# G0 Remote Governance And Image Artifact Evidence

- Task: WP-D / G0 remote governance and immutable image evidence
- Status: `PARTIAL` / TLS and default-branch discovery restored; blocked on remote administrative evidence and trusted published-image evidence
- Evidence date: 2026-07-29 (Asia/Shanghai; remote rechecked after `e090dda`)
- Scope owner: Integration governance line

## Task Boundary

Known facts:

- The local `main` history contains the G3 base `e090dda` plus the reviewed documentation and governance follow-ups, and has a locally configured `origin` URL and fetch refspec.
- TLS access is restored for this Worktree by selecting Git's OpenSSL backend after the independent review reproduced one intermittent Schannel `missing close_notify` failure. GitHub Web/API requests succeed and eight consecutive `git ls-remote --symref origin HEAD` checks exit successfully. The remote repository is empty, so they return no refs.
- GitHub's public repository API reports `main` as the configured default branch. Because the repository has no commits or branches, this setting is not yet a protected branch or merge-governance fact.
- GitHub CLI is installed but has no authenticated GitHub host or `GH_TOKEN` in this execution context.
- There are no remote commits, branches, pull requests, Actions runs or cached `origin/*` remote-tracking refs. Local branches and Worktrees are not remote governance evidence.
- `.github/workflows/ci.yml` defines `pnpm check` for pull requests and pushes to a locally named `main` branch.
- `.github/CODEOWNERS` now assigns repository-wide ownership to the confirmed repository owner `@chien-zZ`; server-side required CODEOWNERS review is still absent.
- The repository contains reviewed non-root API and Worker Dockerfiles plus `.github/workflows/application-images.yml` for commit-addressed builds and migration-manifest verification before push. The workflow now runs only for pushes to `main`, but this becomes a protected-commit gate only after remote `main` protection is established.
- No trusted workflow run, immutable registry digest, build attestation or successful protected publication record is available in this workspace.

Allowed assumptions:

- The configured `origin` is the readable public GitHub repository endpoint. Its configured default branch is `main` and its refs are confirmed empty; permissions and protection settings remain unconfirmed until the first controlled push and authenticated governance export.
- The repository image pipeline and embedded-manifest verifier are implementation evidence only until the trusted pipeline produces and verifies immutable registry digests.

Forbidden assumptions:

- Do not treat a configured remote URL, a local `main` branch, a local workflow file, local Review notes, or Worktree isolation as server-side branch protection.
- Do not infer that the configured default branch already exists or is protected, or infer a required status check, PR approval rule, CODEOWNERS review, force-push protection, deletion protection, or successful CI run.
- Do not claim image evidence from repository migration directories, synthetic filesystem fixtures, Compose image variables, or static manifest tests.
- Do not invent an image layout, registry, build credential, GitHub owner/team, required check name, Task projection value, or production Secret.

Non-goals:

- No push, remote repository mutation, branch-protection mutation, PR creation, reviewer assignment, registry access, image publication or deployment.
- No change to contracts, API, Worker, business modules, Task retry/concurrency parameters or production consumers.

## G0 Evidence Matrix

| Requirement | Available evidence | Result |
|---|---|---|
| Remote configured | Local config has `origin=https://github.com/chien-zZ/AI-CRM-step1.git` and the normal heads fetch refspec | `LOCAL_ONLY` |
| Remote repository and refs readable | TLS/API access succeeds; the public remote is empty and has no refs or cached `origin/*` refs | `PARTIAL` |
| Default branch | GitHub's repository API reports configured default `main`; no branch ref exists yet | `CONFIGURED/NOT_CREATED` |
| Required status checks | Local CI declares one `check` job, but no authenticated branch-protection response or completed remote check run is available | `UNVERIFIED` |
| Required PR review | No authenticated ruleset/branch-protection response or PR evidence is available | `UNVERIFIED` |
| Required CODEOWNERS review | Repository-wide `@chien-zZ` ownership is effective in the file; no server-side review rule or independent-review PR evidence is available | `LOCAL_READY/UNVERIFIED` |
| Force-push protection | No authenticated ruleset/branch-protection response is available | `UNVERIFIED` |
| Branch deletion protection | No authenticated ruleset/branch-protection response is available | `UNVERIFIED` |

Conclusion: G0 remains `PARTIAL`. TLS and configured default-branch discovery are closed, but none of the remote enforcement requirements above is closed by current evidence.

## Immutable API/Worker Image Evidence

The existing implementation provides:

- deterministic inventory and digest generation for reviewed `packages/**/migrations` files;
- a joint verifier that requires both already-unpacked API and Worker filesystems to contain the fixed embedded manifest and the complete approved migration set;
- rejection of missing, extra, modified, malformed and symbolic-link content, with one external approved digest binding both artifacts.

The repository-side image foundation is now implemented, but image evidence remains blocked because no trusted pipeline run, registry digest, build attestation, published image filesystem or protected release record is available. The workflow is locally restricted to pushes to `main`; because remote `main` does not yet exist or have protection, this is necessary implementation evidence but not protected-commit proof. The authorized release operator must establish and export remote protection, then retain the exact API/Worker digests and prove the embedded migration manifests match the approved release evidence. Repository files and synthetic fixtures alone cannot close this gate.

## Verification Commands

- `git branch -a -vv`: local `main` and local task branches only; no `remotes/origin/*` entries.
- `git config --get-regexp "^branch\\.|^remote\\.origin\\."`: local origin URL/fetch refspec recorded; no branch upstream configuration returned.
- `git config --local http.sslBackend openssl` avoids the independently reproduced intermittent Schannel close-notify failure; eight consecutive `git ls-remote --symref origin HEAD` checks exit successfully with no refs because the public remote is empty.
- GitHub public repository API: repository is readable, `default_branch` is `main`, repository rulesets are empty, and branches/PRs/Actions runs are absent.
- `gh auth status`: no authenticated GitHub host.
- `gh repo view ...` / branch protection API: unavailable without authentication.
- `.github/CODEOWNERS`: repository-wide `@chien-zZ` owner entry; server-side enforcement remains unverified.
- `.github/workflows/ci.yml`: local `pnpm check` definition; `.github/workflows/application-images.yml` now permits image build/verify/publish only on pushes to `main`.
- `apps/api/Dockerfile` and `apps/worker/Dockerfile`: reviewed non-root build definitions exist.
- No trusted image publication or registry-digest evidence was produced in this documentation update.

## Required Follow-up Evidence

1. Create the configured `main` branch through the approved initial push and confirm its symbolic remote HEAD; TLS/read access and the configured default name are already verified.
2. Obtain a read-only authenticated ruleset/branch-protection export proving required checks, minimum approvals/CODEOWNERS behavior, force-push prohibition and deletion prohibition.
3. Record a real PR that satisfied those rules and a successful required-check run; do not expose credentials in the evidence.
4. Prove that the server requires the confirmed CODEOWNER's review where intended, with a distinct real reviewer for the acceptance PR; do not treat self-review as approval evidence.
5. Prove the image workflow's push-to-`main` trigger can only receive commits that entered through the protected required-PR path.
6. Run the reviewed API/Worker image pipeline in the trusted environment, then retain the exact registry digests, build evidence and successful embedded-manifest verification output.

## Local Verification Result

- `node --test scripts/check/migration-artifact.test.mjs scripts/check/production-deployment-gates.test.mjs`: 12/12 passed.
- `pnpm compose:check`: passed.
- `git diff --check`: passed.
- Repository-side Dockerfiles and the image workflow are present after `e090dda`, but no trusted API/Worker image was published in this documentation update; local/static results are not production image evidence.
