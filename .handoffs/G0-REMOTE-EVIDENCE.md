# G0 Remote Governance And Image Artifact Evidence

- Task: WP-D / G0 remote governance and immutable image evidence
- Status: `PARTIAL` / blocked on remote administrative evidence and application image build foundations
- Evidence date: 2026-07-28 (Asia/Shanghai)
- Scope owner: Integration governance line

## Task Boundary

Known facts:

- The local repository is on `main` at `97d7fc76f089ef8886233ade88e8d38855ec275e` and has a locally configured `origin` URL and fetch refspec.
- The current verification could not read `origin` because both `git ls-remote --symref origin HEAD` and `git ls-remote --heads origin` failed during the TLS handshake.
- GitHub CLI is installed but has no authenticated GitHub host or `GH_TOKEN` in this execution context.
- There are no cached `origin/*` remote-tracking refs. Local branches and Worktrees are not remote governance evidence.
- `.github/workflows/ci.yml` defines `pnpm check` for pull requests and pushes to a locally named `main` branch.
- `.github/CODEOWNERS` contains comments and examples only; it assigns no actual user or team.
- The repository contains no API or Worker Dockerfile and no workflow that builds, exports/unpacks, or verifies API/Worker images.
- The repository does contain a fail-closed verifier for two already-unpacked application filesystems and unit evidence for that verifier.

Allowed assumptions:

- The configured `origin` is a candidate GitHub repository endpoint only. Its existence, default branch, refs, permissions and protection settings remain unconfirmed until readable remote evidence is captured.
- The existing unpacked-filesystem verifier may be invoked by a future reviewed image pipeline after immutable API and Worker images exist.

Forbidden assumptions:

- Do not treat a configured remote URL, a local `main` branch, a local workflow file, local Review notes, or Worktree isolation as server-side branch protection.
- Do not infer a remote default branch, required status check, PR approval rule, CODEOWNERS review, force-push protection, deletion protection, repository existence, or successful CI run.
- Do not claim image evidence from repository migration directories, synthetic filesystem fixtures, Compose image variables, or static manifest tests.
- Do not invent an image layout, registry, build credential, GitHub owner/team, required check name, Task projection value, or production Secret.

Non-goals:

- No push, remote repository mutation, branch-protection mutation, PR creation, reviewer assignment, registry access, image publication or deployment.
- No change to contracts, API, Worker, business modules, Task retry/concurrency parameters or production consumers.

## G0 Evidence Matrix

| Requirement | Available evidence | Result |
|---|---|---|
| Remote configured | Local config has `origin=https://github.com/chien-zZ/AI-CRM-step1.git` and the normal heads fetch refspec | `LOCAL_ONLY` |
| Remote repository and refs readable | Current `ls-remote` requests failed at TLS handshake; no cached `origin/*` refs | `UNVERIFIED` |
| Default branch | Local `HEAD -> main` proves only the local branch; remote symbolic `HEAD` was not readable | `UNVERIFIED` |
| Required status checks | Local CI declares one `check` job, but no authenticated branch-protection response or completed remote check run is available | `UNVERIFIED` |
| Required PR review | No authenticated ruleset/branch-protection response or PR evidence is available | `UNVERIFIED` |
| Required CODEOWNERS review | `CODEOWNERS` has no effective owner entry, and no server-side review rule is available | `ABSENT/UNVERIFIED` |
| Force-push protection | No authenticated ruleset/branch-protection response is available | `UNVERIFIED` |
| Branch deletion protection | No authenticated ruleset/branch-protection response is available | `UNVERIFIED` |

Conclusion: G0 remains `PARTIAL`. The local governance process is usable, but none of the remote enforcement requirements above is closed by current evidence.

## Immutable API/Worker Image Evidence

The existing implementation provides:

- deterministic inventory and digest generation for reviewed `packages/**/migrations` files;
- a joint verifier that requires both already-unpacked API and Worker filesystems to contain the fixed embedded manifest and the complete approved migration set;
- rejection of missing, extra, modified, malformed and symbolic-link content, with one external approved digest binding both artifacts.

The image evidence is nevertheless blocked:

- no API or Worker Dockerfile exists;
- no build workflow produces digest-pinned application images;
- no workflow exports or unpacks both produced image filesystems and calls `scripts/deploy/verify-application-migration-artifacts.mjs`;
- no registry digest, build attestation, unpacked image filesystem or successful image-level verifier output is available.

Accordingly, this task did not add a speculative Dockerfile or claim that repository fixtures are images. The next authorized build-window owner must create the reviewed application Dockerfiles/pipeline, copy the same complete migration tree and fixed manifest into both images, build immutable images, export/unpack the exact digest-addressed images, and run the joint verifier against the release manifest's externally approved `artifacts.migrationHead`. Only that successful build/unpack/verify record can close image evidence.

## Verification Commands

- `git branch -a -vv`: local `main` and local task branches only; no `remotes/origin/*` entries.
- `git config --get-regexp "^branch\\.|^remote\\.origin\\."`: local origin URL/fetch refspec recorded; no branch upstream configuration returned.
- `git ls-remote --symref origin HEAD`: blocked by TLS handshake failure.
- `git ls-remote --heads origin`: blocked by TLS handshake failure.
- `gh auth status`: no authenticated GitHub host.
- `gh repo view ...` / branch protection API: unavailable without authentication.
- `.github/CODEOWNERS`: comment-only placeholder.
- `.github/workflows/ci.yml`: local `pnpm check` definition only; no image job.
- `rg --files -g "*Dockerfile*" -g "*.dockerfile"`: no result.
- Docker engine is locally available, but no local AI-CRM API/Worker image was found; engine availability is not build evidence.

## Required Follow-up Evidence

1. Restore read access to the intended remote and record its repository identity plus symbolic default branch.
2. Obtain a read-only authenticated ruleset/branch-protection export proving required checks, minimum approvals/CODEOWNERS behavior, force-push prohibition and deletion prohibition.
3. Record a real PR that satisfied those rules and a successful required-check run; do not expose credentials in the evidence.
4. Replace the placeholder CODEOWNERS examples with confirmed users/teams, then prove that the server requires their review where intended.
5. Add reviewed API/Worker Dockerfiles and an immutable image build pipeline, then retain the exact image digests and successful joint build/unpack/manifest verification output.

## Local Verification Result

- `node --test scripts/check/migration-artifact.test.mjs scripts/check/production-deployment-gates.test.mjs`: 12/12 passed.
- `pnpm compose:check`: passed.
- `git diff --check`: passed.
- No API/Worker image was built or unpacked in this task, so these local results are static gate evidence only and are not image evidence.
