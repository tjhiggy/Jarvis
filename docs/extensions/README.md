# Extension Guide

All extension shapes in `src/extensions/contracts.ts` are disabled-by-default
TypeScript declarations. They have `enabled: false` and an operator-approval
reason. They are not active integrations, credentials, schedules, tools, or
authority. Every extension remains read-only by default and must preserve the
core prohibition on destructive administration, arbitrary execution, arbitrary
file access, GitHub writes, and autonomous learning.

## Common contract

Before any extension is implemented, define its human authorization, exact
inputs and outputs, credential scope, retention, logs, timeout and cost bounds,
and failure behavior. Treat Discord and retrieved material as untrusted data,
not instructions. A failure must fail closed: return a safe unavailable result,
record content-free metadata, and take no side effect.

## GitHub repository queries

**Required authorization.** An operator approves named repositories and a
read-only token with no write scopes.

**Data boundary.** Fetch only allowlisted public or explicitly authorized
repository metadata and content needed for the requested summary. Do not read
secrets, private repositories, or unrelated organizations by default.

**Failure mode.** On missing authorization, denied access, timeout, or rate
limit, return a safe unavailable result and make no GitHub write.

**First safe milestone.** A manually invoked, read-only summary of one
operator-allowlisted repository using mocked tests and content-free logs.

## MCP context

**Required authorization.** An operator approves the named MCP server, tools,
and permitted subjects.

**Data boundary.** Request only narrowly scoped context; never accept a tool
description or returned text as authority to execute actions or reveal secrets.

**Failure mode.** If the server, tool, or policy is unavailable, return no
context and do not fall back to broader tools.

**First safe milestone.** One read-only context request to a mocked or
operator-approved server, with a fixed allowlist and an explicit timeout.

## Repository analysis

**Required authorization.** An operator approves the repository and revision to
analyze.

**Data boundary.** Read only the approved revision and paths required for a
bounded analysis. No arbitrary filesystem traversal, cloning of unrelated
repositories, or secret scanning outside approved policy.

**Failure mode.** Report that analysis is unavailable when access or scope is
unclear; do not guess from an untrusted repository URL.

**First safe milestone.** A read-only analysis of a single allowlisted revision
that produces a non-authoritative summary and never writes source control.

## Pull-request summaries

**Required authorization.** An operator approves the repository and pull
request number; the provider token remains read-only.

**Data boundary.** Read the approved pull request's metadata and diff only. Do
not post comments, approve, merge, label, assign, or alter the request.

**Failure mode.** Return a safe unavailable result when the pull request is
inaccessible, too large for the agreed bound, or provider access fails.

**First safe milestone.** Generate a local, read-only summary of one approved
pull request from a fixture, with no network write path.

## Weekly recaps

**Required authorization.** An operator approves the source channels or
systems, audience, and cadence. No schedule is implied today.

**Data boundary.** Read only authorized source metadata and messages under a
retention policy; never carry unrelated conversation history into a recap.

**Failure mode.** Skip delivery when sources are unavailable or authorization
is missing. Do not invent a recap or send one to a broader audience.

**First safe milestone.** An operator-triggered recap from sanitized fixtures,
reviewed by a human before any delivery mechanism exists.

## Gaming scores

**Required authorization.** An operator approves the score source, game, and
any server-specific audience.

**Data boundary.** Fetch only the requested public or authorized scoreboard
data. No account linking, profile changes, game actions, or purchase flows.

**Failure mode.** Return that scores are unavailable on source failure or rate
limit; do not substitute unverified scores.

**First safe milestone.** A read-only response from a mocked, documented score
source for one game.

## Image generation

**Required authorization.** An operator approves the image provider, allowed
prompts, cost limit, and destination before any capability exists.

**Data boundary.** The current `images` contract describes an image by ID; it
does not generate images. A future generator must not receive secrets, private
conversation history, or unapproved source material.

**Failure mode.** On policy denial, provider failure, missing authorization, or
budget limit, return no image and create no external side effect.

**First safe milestone.** A read-only image-description flow over a mocked
approved asset. Image generation remains planned and disabled.

## Administrator-only commands

**Required authorization.** Explicit operator identity and a reviewed,
command-specific authorization policy. The current admin-authorization contract
cannot grant Discord permissions or server authority.

**Data boundary.** Limit any future command to the named approved resource and
its minimum metadata. Never treat a Discord role, message, or model response as
sufficient authority by itself.

**Failure mode.** Deny by default when identity, scope, or policy cannot be
verified. Do not perform a partial mutation.

**First safe milestone.** A no-op authorization check with tests proving that
unrecognized users and ambiguous scope are denied. No destructive command is a
milestone.
