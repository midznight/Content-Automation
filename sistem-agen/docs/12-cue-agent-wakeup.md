# Legacy Cue Agent Wake-up — Retired

**Status: RETIRED during the Muse App migration.**

The former Manus API wake-up adapter is no longer part of the active Worker runtime. The code and tests for `task.sendMessage` have been removed.

## Current replacement

The active target architecture uses three Muse App identities connected to the existing remote MCP endpoint:

- Muse Controller — Hub role `ceo`
- Animator Primary — Hub role `animator`
- Animator Backup — Hub role `animator_backup`

Telegram creates tasks in Cloudflare D1. Muse App agents read and process their own inbox through the Content Automation Hub Custom Connector. Telegram does not wake Muse sessions directly.

See [13-muse-app-controller.md](./13-muse-app-controller.md) for connector setup, role permissions, Controller instructions, and the manual task-processing flow.

## Legacy data

The `agent_dispatches` table and historical rows are retained for audit and migration reference. They are not read by the active Muse task flow. Do not re-enable the former Manus Cron triggers.

## Previous implementation reference

The old adapter used the Manus `task.sendMessage` API and a persistent Cue main-task ID. It has been removed because the target architecture no longer uses Cue/Manus.
