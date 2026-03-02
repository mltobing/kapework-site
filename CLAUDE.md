# CLAUDE.md — Engineering Standards

This file defines the engineering principles and quality baseline for this project.
Claude Code should align all suggestions, generated code, and architecture decisions with these standards.

---

## The Core Principle

You are a brilliant, fast junior developer. I am the senior engineer.
Generate code that is production-ready, not just functional. When in doubt, flag the trade-off rather than silently picking the easy path.

---

## 1. Secrets & Environment Separation

- Never hardcode credentials, API keys, or tokens in source files
- All secrets live in environment variables (.env files, CI secrets, or platform config)
- .env files are never committed — always in .gitignore
- Use separate credentials for development and production environments
- Anything in a front-end bundle (e.g. GitHub Pages) is effectively public — treat it that way

---

## 2. Observability

- Log errors from day one — not after the first user complaint
- Failures should be visible, not silent (especially on mobile and low-connectivity devices)
- Where possible, persist error logs (e.g. a simple database table) rather than relying on terminal output
- Add health-check mechanisms so you can verify a service is alive without guessing

---

## 3. Wrap External Services

- Third-party API calls belong in a dedicated service/utility module — not scattered inline through UI logic
- The service layer is where caching, retries, rate limiting, and error handling live
- Centralising external calls makes it trivial to swap providers or add resilience later

---

## 4. Server-Side Validation

- Never trust client-supplied input
- Validate and authorise all writes on the server (e.g. database row-level security, server functions)
- AI-generated code tends to assume clean, well-formed data — real users and bad actors do not
- The UI preventing an action is not a security control

---

## 5. Architecture Before Spaghetti

- Break components and modules up early — refactoring later costs far more
- Database schema changes go through versioned migrations, not manual edits
- Plan data models before writing UI — structure at the data layer enables everything above it
- Name things clearly and consistently from the start

---

## 6. Staging Environment

- Maintain a real staging environment that mirrors production
- Test all significant changes in staging before they affect live users or live data
- CORS and access controls should be locked to specific known origins — not open wildcards

---

## 7. Document to Deploy

- Maintain a concise runbook covering: how to run locally, required environment variables, how to deploy, and how to apply database migrations
- Write it now, while context is fresh — future you (or a future collaborator) depends on it
- If you are the only person who knows how to deploy, that is a risk

---

## 8. CI/CD Pipeline

- Deployments come from the pipeline, not from a local machine with a manual script
- Set up automated deployment early, even before formal tests exist
- "It worked locally" is not a deployment strategy

---

## 9. No Silent Technical Debt

- If generated code feels like a workaround, flag it immediately — open a ticket, add a TODO comment with context
- "I'll clean this up later" means it never gets cleaned up
- Feature toggles should be real flags, not commented-out code

---

## 10. Test the Unhappy Paths

- The happy path is easy. Explicitly handle: network failures, unexpected API responses, missing data, and edge cases
- Test backup and restore procedures at least once before you need them in an emergency
- Think through what happens at boundary conditions (midnight rollovers, empty states, first-time users)

---

## 11. Time Handling

- Store all timestamps in UTC
- Convert to the user's local timezone only at the display layer
- Mixing UTC, server time, and local time silently in the same codebase is a debugging nightmare
- Any feature involving "daily" resets or streaks must use the user's local timezone for boundary logic

---

## Summary Checklist

Before considering a feature complete, verify:

- [ ] No secrets in source code or committed files
- [ ] Errors are logged and visible
- [ ] External calls are isolated in a service layer
- [ ] All writes are validated server-side
- [ ] Schema changes are in versioned migrations
- [ ] Tested in staging before production
- [ ] Deployment documented and pipeline-driven
- [ ] Edge cases and failure modes considered
- [ ] Any shortcuts are tracked as issues
- [ ] Time logic uses UTC storage with local display conversion
