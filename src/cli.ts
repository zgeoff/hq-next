#!/usr/bin/env bun
// hq: the z- sessions' headquarters. Typed state, named transitions, atc nudges.
import { Database } from 'bun:sqlite';
import { parseArgs } from 'node:util';
import { addAsk } from './asks/add-ask.ts';
import { answerAsk } from './asks/answer-ask.ts';
import { applyAsk } from './asks/apply-ask.ts';
import { closeAsk } from './asks/close-ask.ts';
import { currentHold } from './asks/current-hold.ts';
import { getAsk } from './asks/get-ask.ts';
import { history } from './asks/history.ts';
import { laterAsk } from './asks/later-ask.ts';
import { listAsks } from './asks/list-asks.ts';
import { nextEligible } from './asks/next-eligible.ts';
import { openAsk } from './asks/open-ask.ts';
import { openItem } from './asks/open-item.ts';
import { skipAsk } from './asks/skip-ask.ts';
import type { Ask, Kind } from './asks/types.ts';
import { waitReasons } from './asks/wait-reasons.ts';
import { logEvent } from './log-event.ts';
import { owner } from './owner.ts';
import type { AskState } from './transitions/ask-states.ts';
import { AtcClient } from './atc/atc-client.ts';
import { fleetIds } from './atc/fleet-ids.ts';
import { sessionGetSchema } from './atc/session-get-schema.ts';
import { makeFleetClient } from './fleet/make-fleet-client.ts';
import { hasStaleOps } from './fleet/has-stale-ops.ts';
import { readStuckSaveChecks } from './fleet/read-stuck-save-checks.ts';
import { formatWrapUp } from './runs/format-wrap-up.ts';
import { readImpWork } from './runs/read-imp-work.ts';
import { runWrapUp } from './runs/run-wrap-up.ts';
import type { WrapUpDeps } from './runs/run-wrap-up.ts';
import { sessionListRequiredSchema } from './atc/session-list-required-schema.ts';
import { fmtIdle } from './pins/fmt-idle.ts';
import { listPins } from './pins/list-pins.ts';
import { launchDetached } from './restart/launch-detached.ts';
import { restartHere } from './restart/restart-here.ts';
import { selfCommand } from './restart/self-command.ts';
import { loadBand } from './band/load-band.ts';
import { loadPane } from './band/load-pane.ts';
import { findFleetName } from './atc/find-fleet-name.ts';
import { createStoreBackup } from './noslop/create-store-backup.ts';
import { runNoslopCommand } from './noslop/run-noslop-command.ts';
import { readOwnerSession } from './pr-status/read-owner-session.ts';
import { identitySocketPath } from './atc/identity-socket-path.ts';
import { OWNER_PROBE_OPENER } from './pr-status/owner-probe-opener.ts';
import { runConsoleLogin } from './console-auth/run-console-login.ts';
import { runCallAnswer } from './asks/run-call-answer.ts';
import { readRoleSession } from './pr-status/read-role-session.ts';
import type { OwnerProbeDeps } from './pr-status/read-owner-session.ts';
import { runPRCommand } from './pr-status/run-pr-command.ts';
import { runReviewCommand } from './review-command.ts';
import { runConsole } from './run-console.ts';
import { formatItemLines } from './format-item-lines.ts';
import { formatUnblockLater } from './format-unblock-later.ts';
import { runItemCommand } from './run-item-command.ts';
import { checkFleetBuild } from './roles/check-fleet-build.ts';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { checkLanesBuild } from './lanes/check-lanes-build.ts';
import { rolesByName } from './roles/roles-by-name.ts';
import { withStaleBuild } from './roles/with-stale-build.ts';
import { addNote } from './runs/add-note.ts';
import { addPr } from './runs/add-pr.ts';
import { addRun } from './runs/add-run.ts';
import { checkMergedOnGitHub } from './runs/check-merged-on-github.ts';
import { readMergedPR } from './runs/read-merged-pr.ts';
import { closePr } from './runs/close-pr.ts';
import { finalPr } from './runs/final-pr.ts';
import { fullSessionId } from './runs/full-session-id.ts';
import { getRun } from './runs/get-run.ts';
import { ingestNotes } from './runs/ingest-notes.ts';
import { listRuns } from './runs/list-runs.ts';
import { notesFor } from './runs/notes-for.ts';
import { resolveRun } from './runs/resolve-run.ts';
import { reviewStarted } from './runs/review-started.ts';
import { reviewedPr } from './runs/reviewed-pr.ts';
import { formatPRTag } from './runs/format-pr-tag.ts';
import { setField } from './runs/set-field.ts';
import { setGeoffChat } from './runs/set-geoff-chat.ts';
import { setPlace } from './runs/set-place.ts';
import { setLiveCheck } from './runs/set-live-check.ts';
import { setSession } from './runs/set-session.ts';
import { setState } from './runs/set-state.ts';
import { sweepNow } from './runs/sweep-now.ts';
import type { LiveCheck, RunView, WrapUp } from './runs/types.ts';
import { unfinalPr } from './runs/unfinal-pr.ts';
import { unmergePr } from './runs/unmerge-pr.ts';
import { viewRun } from './runs/view-run.ts';
import { watchlist } from './runs/watchlist.ts';
import { boundedRunner } from './runner/bounded-runner.ts';
import { cleanEnv } from './runner/clean-env.ts';
import { realRunner } from './runner/real-runner.ts';
import type { Runner } from './runner/types.ts';
import type { Ctx, Out } from './commands.ts';
import { registerGroups } from './register-groups.ts';
import { lookup } from './lookup.ts';
import { z } from 'zod';
import { config } from './config/config.ts';
import { toExactOptional } from '@zgeoff/std';
import type { DetachResult, FlushResult, OutboxRow } from './outbox/types.ts';
import { dropOutboxItem } from './outbox/drop-outbox-item.ts';
import { forwards } from './outbox/forwards.ts';
import { setForward } from './outbox/set-forward.ts';
import { takeQueued } from './outbox/take-queued.ts';
import { send } from './send/send.ts';
import { GOAL_KEYS } from './goals/goal-keys.ts';
import { goalTargets } from './goals/goal-targets.ts';
import { setTarget } from './goals/set-target.ts';
import { targetLine } from './goals/target-line.ts';
import { goalRows } from './goals/goal-rows.ts';
import { goalsText } from './goals/goals-text.ts';
import { refreshActionsSpend } from './goals/refresh-actions-spend.ts';
import { syncGoals } from './goals/sync-goals.ts';
import { goalsDailyCheck } from './goals/daily/goals-daily-check.ts';
import { goalsWeeklyCheck } from './goals/weekly/goals-weekly-check.ts';
import { sendWeekly } from './goals/weekly/send-weekly.ts';
import { skipWeekly } from './goals/weekly/skip-weekly.ts';
import { weeklyText } from './goals/weekly/weekly-text.ts';
import { dailyText } from './goals/daily/daily-text.ts';
import { sendDaily } from './goals/daily/send-daily.ts';
import { skipDaily } from './goals/daily/skip-daily.ts';
import { FRESH_MIN } from './goals/fresh-min.ts';
import { goalsAge } from './goals/goals-age.ts';
import { downtime } from './probe/downtime.ts';
import { lastReady } from './probe/last-ready.ts';
import { lastSample } from './probe/last-sample.ts';
import { openOutage } from './probe/open-outage.ts';
import { openUnready } from './probe/open-unready.ts';
import { outagesIn } from './probe/outages-in.ts';
import { readLocalConfigCheck } from './health/read-local-config-check.ts';
import { probeHealth } from './probe/probe-health.ts';
import { probeOnce } from './probe/probe-once.ts';
import { buildProbeTimerUnits } from './probe/probe-timer-units.ts';
import { PROBE_UNIT } from './probe/probe-unit.ts';
import { realFetcher } from './probe/real-fetcher.ts';
import { unreadyIn } from './probe/unready-in.ts';
import { checkLane } from './areas/check-lane.ts';
import { laneArgs } from './areas/lane-args.ts';
import { parkedRuns } from './areas/parked-runs.ts';
import { parseReadyTotal } from './areas/parse-ready-total.ts';
import { parseReady } from './areas/parse-ready.ts';
import { parseSkipped } from './areas/parse-skipped.ts';
import { readySummary } from './areas/ready-summary.ts';
import { reportLaneReady } from './areas/report-lane-ready.ts';
import { runningByLane } from './areas/running-by-lane.ts';
import { setRunLane } from './areas/set-run-lane.ts';
import { skippedLines } from './areas/skipped-lines.ts';
import { declaredFleet } from './fleet/declared-fleet.ts';
import { formatDriftLines } from './fleet/format-drift-lines.ts';
import { ensureFleet } from './fleet/ensure-fleet.ts';
import { loadFleetLast } from './fleet/load-fleet-last.ts';
import { fleetTimerUnits } from './fleet/fleet-timer-units.ts';
import { runUnitsCommand } from './units/run-units-command.ts';
import { writeClockWarnings } from './clock/write-clock-warnings.ts';
import { FLEET_UNIT } from './fleet/fleet-unit.ts';
import { BACKUP_UNIT } from './backup/backup-unit.ts';
import { removeTimer } from './fleet/remove-timer.ts';
import { fleetTrustChecks } from './fleet/fleet-trust-checks.ts';
import { buildFleetChecks } from './fleet/build-fleet-checks.ts';
import { findPluginDrift } from './fleet/find-plugin-drift.ts';
import { promptDrift } from './fleet/prompt-drift.ts';
import { rcWatch } from './fleet/rc-watch.ts';
import { retireName } from './fleet/retire-name.ts';
import { retiredNames } from './fleet/retired-names.ts';
import type { FleetClient, PluginDrift, PromptDrift, RcDeps } from './fleet/types.ts';
import { capacitySettings } from './capacity/capacity-settings.ts';
import { formatCapacityHint } from './capacity/format-capacity-hint.ts';
import { readCapacityHint } from './capacity/read-capacity-hint.ts';
import { runCapacityStep } from './capacity/run-capacity-step.ts';
import { latestSample } from './capacity/latest-sample.ts';
import { openAlerts } from './capacity/open-alerts.ts';
import { readingText } from './capacity/reading-text.ts';
import { sampleLog } from './capacity/sample-log.ts';
import { setCapacitySetting } from './capacity/set-capacity-setting.ts';
import { thresholdLines } from './capacity/threshold-lines.ts';
import { buildCapacityProbe } from './capacity/build-capacity-probe.ts';
import { eligibleNow } from './lanes/eligible-now.ts';
import { getLanesHold } from './lanes/get-lanes-hold.ts';
import { holdLanes } from './lanes/hold-lanes.ts';
import { idleSlotMinutes } from './lanes/idle-slot-minutes.ts';
import { formatLineRoom } from './lanes/format-line-room.ts';
import { readSlotPlan } from './lanes/read-slot-plan.ts';
import { formatSlotPlan } from './lanes/format-slot-plan.ts';
import { loadImpRoom } from './lanes/load-imp-room.ts';
import { LANES } from './lanes/lanes.ts';
import { nudgeLog } from './lanes/nudge-log.ts';
import { loadPacing } from './lanes/load-pacing.ts';
import { pacingPath } from './lanes/pacing-path.ts';
import { buildLanePlan } from './lanes/build-lane-plan.ts';
import { formatLanePlan } from './lanes/format-lane-plan.ts';
import { readCapacity } from './lanes/read-capacity.ts';
import { readLanes } from './lanes/read-lanes.ts';
import { releaseLanes } from './lanes/release-lanes.ts';
import { parseLanesCapArgs } from './lanes/cap/parse-lanes-cap-args.ts';
import { runLanesCapCommand } from './lanes/cap/run-lanes-cap-command.ts';
import { readCapClock } from './lanes/cap/read-cap-clock.ts';
import { readFallbackCapView } from './lanes/cap/read-fallback-cap-view.ts';
import { formatCapLine } from './lanes/cap/format-cap-line.ts';
import { parseLaneSkipArgs } from './lanes/parse-lane-skip-args.ts';
import { runLaneSkipCommand } from './lanes/run-lane-skip-command.ts';
import { reportReady } from './lanes/report-ready.ts';
import { slotsFrom } from './lanes/slots-from.ts';
import { tick } from './lanes/tick.ts';
import { defsSourceFile } from './prompts/defs-source-file.ts';
import { defsSource } from './prompts/defs-source.ts';
import { DEFS_SOURCES } from './prompts/defs-sources.ts';
import { DEFS } from './prompts/defs.ts';
import { countAnswerWeeks } from './answers/count-answer-weeks.ts';
import { formatAnswerLine } from './answers/format-answer-line.ts';
import { loadAnswers } from './answers/load-answers.ts';
import { mergeAnswerWeeks } from './answers/merge-answer-weeks.ts';
import { createGrantMark } from './grants/create-grant-mark.ts';
import { formatGrantLine } from './grants/format-grant-line.ts';
import { loadGrantTallies } from './grants/load-grant-tallies.ts';
import { parseGrantVoidArgs } from './grants/parse-grant-void-args.ts';
import { recordGrantAction } from './grants/record-grant-action.ts';
import { voidGrantAction } from './grants/void-grant-action.ts';
import { updateMarkGrantName } from './grants/update-mark-grant-name.ts';
import { orchestratorName } from './wake/orchestrator-name.ts';
import { parseWakeFile } from './wake/parse-wake-file.ts';
import { runWake } from './wake/run-wake.ts';
import { wakeAdd } from './wake/wake-add.ts';
import { wakeList } from './wake/wake-list.ts';
import { wakeRemove } from './wake/wake-remove.ts';
import { formatDoneWhen } from './unblock/format-done-when.ts';
import { addDoneWhen } from './unblock/add-done-when.ts';
import { addUnblock } from './unblock/add-unblock.ts';
import { closeUnblock } from './unblock/close-unblock.ts';
import { getUnblock } from './unblock/get-unblock.ts';
import { isOverdue } from './unblock/is-overdue.ts';
import { isRecheck } from './unblock/is-recheck.ts';
import { parseWatchFlags } from './unblock/parse-watch-flags.ts';
import { listUnblocks } from './unblock/list-unblocks.ts';
import { markPushed } from './unblock/mark-pushed.ts';
import { newSincePush } from './unblock/new-since-push.ts';
import { parseDoneWhen } from './unblock/parse-done-when.ts';
import { parseUnblocks } from './unblock/parse-unblocks.ts';
import { pushedSeq } from './unblock/pushed-seq.ts';
import { rankUnblock } from './unblock/rank-unblock.ts';
import type { UnblockItem } from './unblock/types.ts';
import { uptoFor } from './unblock/upto-for.ts';
import { CHECKED_AT } from './releases/checked-at.ts';
import { formatShippedAt } from './releases/format-shipped-at.ts';
import { shipRuns } from './releases/ship-runs.ts';

import { formatReferenceLines } from './refs/format-reference-lines.ts';
import { readReferenceCounts } from './refs/read-reference-counts.ts';
import { BY } from './refusals/by.ts';
import { countRefusals as tally } from './refusals/count-refusals.ts';
import { formatRefusalLine as refusalLine } from './refusals/format-refusal-line.ts';
import { loadRefusalRows as refusalRows } from './refusals/load-refusal-rows.ts';
import { parseDays } from './refusals/parse-days.ts';
import { scanRefusals } from './refusals/scan-refusals.ts';
import type { By } from './refusals/types.ts';
import { addNews } from './news/add-news.ts';
import { digest } from './news/digest.ts';
import { listNews } from './news/list-news.ts';
import { readNews } from './news/read-news.ts';
import { unreadCount } from './news/unread-count.ts';
import { getMeta } from './db/get-meta.ts';
import { metaJson } from './db/meta-json.ts';
import { openDb } from './db/open-db.ts';
import { SCHEMA_VERSION } from './db/schema-version.ts';
import { readBuild } from './build/read-build.ts';
import { renderVersion } from './build/render-version.ts';
import { setMeta } from './db/set-meta.ts';
import { iso } from './clock/iso.ts';
import { now } from './clock/now.ts';
import { readWallClock } from './clock/read-wall-clock.ts';
import { accountLabels } from './accounts/account-labels.ts';
import { setAccountLabel } from './accounts/set-account-label.ts';
import { capabilities } from './capabilities/capabilities.ts';

import { CALL_MS } from './watcher/call-ms.ts';
import { watchLoop } from './watcher/watch-loop.ts';
import { sendStaleWatcherAlerts } from './watcher/send-stale-watcher-alerts.ts';
import { watcherAlert } from './watcher/watcher-alert.ts';
import { watcherState } from './watcher/watcher-state.ts';
import { installLanes } from './lanes-unit/install-lanes.ts';
import { LANES_UNIT } from './lanes-unit/lanes-unit.ts';
import { stopLanes } from './lanes-unit/stop-lanes.ts';
import { addMark } from './marks/add-mark.ts';
import { dropMark } from './marks/drop-mark.ts';
import { getMark } from './marks/get-mark.ts';
import { listMarks } from './marks/list-marks.ts';
import { markVersion } from './marks/mark-version.ts';
import { compareText } from './stats/compare-text.ts';
import { computeStats } from './stats/compute-stats.ts';
import { headline } from './stats/headline.ts';
import { statsText } from './stats/stats-text.ts';
import type { GhMerge } from './stats/types.ts';
import { kindText } from './kinds/kind-text.ts';
import { kindWeeks } from './kinds/kind-weeks.ts';
import { linearState } from './kinds/linear-state.ts';
import { mondayOf } from './kinds/monday-of.ts';
import { syncKinds } from './kinds/sync-kinds.ts';
import { syncLinear } from './kinds/sync-linear.ts';
import { weeksBack } from './kinds/weeks-back.ts';
import { makeAuditedLinearCaller } from './linear/make-audited-linear-caller.ts';
import { formatSlotCause } from './lanes/format-slot-cause.ts';
import { readPromotableIssues } from './lanes/read-promotable-issues.ts';
import { readSlotCause } from './lanes/read-slot-cause.ts';
import { readSlotMinutes } from './lanes/read-slot-minutes.ts';
import rulesTable from '../lanes.json';
import { runFocusCommand } from './focus/run-focus-command.ts';
import { runLinearCommand } from './linear/run-linear-command.ts';
import { mergedRuns } from './sizes/merged-runs.ts';
import { parseSize } from './sizes/parse-size.ts';
import { prFacts } from './sizes/pr-facts.ts';
import { setSize } from './sizes/set-size.ts';
import { sizeStats } from './sizes/size-stats.ts';
import { sizeText } from './sizes/size-text.ts';
import { addTyped } from './typed/add-typed.ts';
import { listTyped } from './typed/list-typed.ts';
import { parseSource } from './typed/parse-source.ts';
import { typedSource } from './typed/typed-source.ts';
import type { Typed } from './typed/types.ts';
import { morningCheck } from './morning/morning-check.ts';
import { morningText } from './morning/morning-text.ts';
import { morningTick } from './morning/morning-tick.ts';
import { recentRuns } from './morning/recent-runs.ts';
import { skipMorning } from './morning/skip-morning.ts';
import { sydney } from './morning/sydney.ts';
import { windows } from './morning/windows.ts';
import { parseSource as parseDefsSource } from './defs/parse-source.ts';
import { preflight } from './defs/preflight.ts';
import { setupCheckout } from './defs/setup-checkout.ts';
import { parseTree } from './defs/parse-tree.ts';
import { runSyncCommand } from './defs/run-sync-command.ts';
import { runRepoCommand } from './repo/run-repo-command.ts';
import { readFetchCheck } from './defs/read-fetch-check.ts';
import { readTreeCheck } from './defs/read-tree-check.ts';
import { useSource } from './defs/use-source.ts';
import { addBackfill } from './followups/add-backfill.ts';
import { addFollowup } from './followups/add-followup.ts';
import { dropFollowup } from './followups/drop-followup.ts';
import { listFollowups } from './followups/list-followups.ts';
import { parseFixed } from './followups/parse-fixed.ts';
import { parseFollowups } from './followups/parse-followups.ts';
import { reviewStats } from './followups/review-stats.ts';
import { reviewText } from './followups/review-text.ts';
import { rcState } from './rc/rc-state.ts';
import { backupPaths } from './backup/backup-paths.ts';
import { ensurePassword } from './backup/ensure-password.ts';
import { KEEP } from './backup/keep.ts';
import { lastBackup } from './backup/last-backup.ts';
import { readRemoteEnv } from './backup/read-remote-env.ts';
import { restoreTest } from './backup/restore-test.ts';
import { restore } from './backup/restore.ts';
import { runBackup } from './backup/run-backup.ts';
import { snapshots } from './backup/snapshots.ts';
import { timerUnits } from './backup/timer-units.ts';
import { applyHealth } from './health/apply-health.ts';
import { healthSamples } from './health/health-samples.ts';
import { healthSettings } from './health/health-settings.ts';
import { openProblems } from './health/open-problems.ts';
import { runChecks } from './health/run-checks.ts';
import { setHealthSetting } from './health/set-health-setting.ts';
import type { Probe } from './health/types.ts';
import { repairAdvisor400 } from './repair/repair-advisor400.ts';
import { HqError } from './errors.ts';
import { HELP } from './help.ts';
import { readMoveRefusal } from './runs/read-move-refusal.ts';
import { VERSION } from './version.ts';

const OPTIONS = {
  json: { type: 'boolean' },
  prompts: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  by: { type: 'string' },
  force: { type: 'boolean' },
  title: { type: 'string' },
  question: { type: 'string' },
  body: { type: 'string' },
  'body-file': { type: 'string' },
  issues: { type: 'string' },
  for: { type: 'string' },
  answer: { type: 'string' },
  'answer-file': { type: 'string' },
  to: { type: 'string' },
  note: { type: 'string' },
  until: { type: 'string' },
  item: { type: 'string' },
  view: { type: 'string' },
  reason: { type: 'string' },
  state: { type: 'string' },
  history: { type: 'boolean' },
  id: { type: 'string' },
  task: { type: 'string' },
  minutes: { type: 'string' },
  unblocks: { type: 'string' },
  rank: { type: 'string' },
  notify: { type: 'string' },
  'done-when': { type: 'string', multiple: true },
  retry: { type: 'boolean' },
  ids: { type: 'string' },
  upto: { type: 'string' },
  order: { type: 'string' },
  'dry-run': { type: 'boolean' },
  now: { type: 'string' },
  wait: { type: 'string' },
  here: { type: 'boolean' },
  interval: { type: 'string' },
  port: { type: 'string' },
  count: { type: 'string' },
  limit: { type: 'string' },
  'no-watch': { type: 'boolean' },
  full: { type: 'boolean' },
  'fixes-only': { type: 'boolean' },
  confirm: { type: 'boolean' },
  effort: { type: 'string' },
  require: { type: 'string' },
  'repo-dir': { type: 'string' },
  rule: { type: 'string' },
  session: { type: 'string' },
  where: { type: 'string' },
  next: { type: 'string' },
  gate: { type: 'string' },
  'geoff-chat': { type: 'boolean' },
  'waits-on': { type: 'string' },
  reopen: { type: 'boolean' },
  sha: { type: 'string' },
  recheck: { type: 'boolean' },
  label: { type: 'string' },
  all: { type: 'boolean' },
  notes: { type: 'string' },
  write: { type: 'string' },
  add: { type: 'boolean' },
  remove: { type: 'boolean' },
  from: { type: 'string' },
  topic: { type: 'string' },
  text: { type: 'string' },
  'text-file': { type: 'string' },
  source: { type: 'string' },
  clear: { type: 'boolean' },
  fixed: { type: 'string' },
  followups: { type: 'string' },
  backfill: { type: 'boolean' },
  date: { type: 'string' },
  lane: { type: 'string' },
  issue: { type: 'string' },
  link: { type: 'string' },
  'needs-geoff': { type: 'boolean' },
  snapshot: { type: 'string' },
  'ready-since': { type: 'string' },
  size: { type: 'string' },
  lines: { type: 'string' },
  'waits-on-geoff': { type: 'boolean' },
  'not-geoff': { type: 'boolean' },
  since: { type: 'string' },
  weeks: { type: 'string' },
  days: { type: 'string' },
  hours: { type: 'string' },
  reset: { type: 'boolean' },
  around: { type: 'string' },
  kind: { type: 'string' },
  deadline: { type: 'string' },
  ref: { type: 'string' },
  at: { type: 'string' },
  remote: { type: 'boolean' },
  tag: { type: 'string' },
  apply: { type: 'boolean' },
  file: { type: 'string' },
  check: { type: 'string' },
  'ready-total': { type: 'string' },
  skipped: { type: 'string' },
  'budget-mb': { type: 'string' },
  grant: { type: 'string' },
  target: { type: 'string' },
  team: { type: 'string' },
  'updated-since': { type: 'string' },
  fields: { type: 'string' },
  out: { type: 'string' },
  reserve: { type: 'string', multiple: true },
} as const;

export type Flags = ReturnType<typeof parse>['values'];

function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
}

async function readText(inline: string | undefined, file: string | undefined, what: string): Promise<string> {
  if (inline !== undefined && file !== undefined) throw new HqError('bad_args', `give --${what} or --${what}-file, not both`);
  if (inline !== undefined) return inline;
  if (file === '-') return await Bun.stdin.text();
  if (file !== undefined) return await Bun.file(file).text();
  throw new HqError('bad_args', `--${what} or --${what}-file is required`);
}

function need(v: string | undefined, flag: string): string {
  if (v === undefined || v.trim() === '') throw new HqError('bad_args', `--${flag} is required`);
  return v;
}

function intFlag(v: string | undefined, flag: string): number | null {
  if (v === undefined || v === 'none') return null;
  if (!/^-?\d+$/.test(v)) throw new HqError('bad_args', `--${flag} must be a whole number`);
  return Number(v);
}

function pickAskStates(state: string | undefined): AskState[] | undefined {
  if (state === 'all') {
    return undefined;
  }
  if (state) {
    return list(state) as AskState[];
  }
  return ['open', 'queued', 'later', 'answered'];
}

function parseWaitsOn(v: string | undefined): string | null | undefined {
  if (v === undefined) {
    return undefined;
  }
  return v === 'none' ? null : v;
}

function parseGeoffFlag(flags: Flags): boolean | undefined {
  if (flags['waits-on-geoff']) {
    return true;
  }
  return flags['not-geoff'] ? false : undefined;
}

function getHome(): string {
  const home = process.env['HOME'];
  if (home === undefined) {
    throw new HqError('bad_config', 'HOME is not set');
  }
  return home;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function readOwnerProbeDeps(): OwnerProbeDeps {
  return { openClient: OWNER_PROBE_OPENER.open ?? openOwnerProbeClient };
}

function openOwnerProbeClient(): Promise<AtcClient> {
  return AtcClient.open(identitySocketPath(), 1500);
}

async function actor(db: Database, flags: Flags): Promise<string> {
  if (flags.by) return flags.by;
  const as = config().HQ_AS,
    sid = process.env['ATC_SESSION_ID'];
  if (as) return as;
  if (!sid) return 'unknown';
  const cached = getMeta(db, `session_name:${sid}`);
  if (cached) return cached;
  try {
    const c = await AtcClient.open(undefined, 1500);
    try {
      const s = await c.resolve(sid);
      setMeta(db, `session_name:${sid}`, s.name);
      return s.name;
    } finally {
      c.close();
    }
  } catch (e) {
    if ((e as HqError).code === 'atc_protocol_mismatch') throw e; // never hidden behind a fallback
    return sid;
  }
}

// ---------- text rendering ----------

const STATE_MARK: Record<AskState, string> = {
  queued: '·',
  open: '▶',
  answered: '✓',
  applied: '✔',
  later: '⏸',
  skipped: '↷',
  closed: '✕',
};

function askLine(a: Ask): string {
  const extra = a.state === 'later' ? ` until ${a.due_at}` : a.state === 'applied' ? ` → ${a.applied_to}` : '';
  const issues = a.issues.length ? ` (${a.issues.join(', ')})` : '';
  return `${STATE_MARK[a.state]} ${a.kind} ${a.id} [${a.state}${extra}]: ${a.title}${issues}`;
}

function askFull(a: Ask): string {
  const lines = [askLine(a), `  question: ${a.question}`, `  filed by ${a.filed_by}${a.for_session ? ` for ${a.for_session}` : ''}, round ${a.round}`];
  if (a.answer !== null) lines.push(`  answer (${a.answered_at}): ${a.answer}`);
  if (a.applied_to) lines.push(`  applied ${a.applied_at} to ${a.applied_to}${a.applied_note ? `: ${a.applied_note}` : ''}`);
  if (a.close_reason) lines.push(`  reason: ${a.close_reason}`);
  lines.push(...formatItemLines(a.stu_view, a.item));
  lines.push('', a.body);
  return lines.join('\n');
}

function unblockLine(u: UnblockItem, i?: number): string {
  const n = i === undefined ? '' : `${i + 1}. `;
  const mins = u.minutes === null ? '' : ` · about ${u.minutes} min`;
  const what = u.unblocks.length ? ` · unblocks ${u.unblocks.map((x) => `${x.issue} (${x.priority})`).join(', ')}` : '';
  const rank = u.rank === null ? '' : ` · rank ${u.rank}`;
  const state = u.state === 'open' ? '' : ` [${u.state}]`;
  const doneWhen = u.done_when.length > 0 ? ` · done when ${formatDoneWhen(u.done_when)}` : '';
  const recheck = isRecheck(u, now()) ? ' · recheck' : '';
  const watch = u.kind === 'watch' ? ' · watch' : '';
  const deadline = u.deadline === null ? '' : ` · deadline ${u.deadline}${isOverdue(u, now()) ? ' OVERDUE' : ''}`;
  return `${n}${u.task}${watch}${mins}${what}${doneWhen}${deadline} · added ${u.added_at}${rank} · id ${u.id}${state}${recheck}${formatUnblockLater(u)}`;
}

function flushNote(f: (FlushResult & { pending?: number }) | null): string {
  if (!f) return '';
  if (f.skipped) return '\n(messages held: HQ_NOTIFY=off)';
  const parts: string[] = [];
  if (f.sent) parts.push(`${f.sent} message${f.sent > 1 ? 's' : ''} sent`);
  if ('pending' in f && f.pending) parts.push(`${f.pending} still sending`);
  if (f.failed) parts.push(`${f.failed} failed, kept in the outbox: ${f.errors.join('; ')}`);
  return parts.length ? `\n(${parts.join('; ')})` : '';
}

// ---------- commands ----------

async function askCommand(db: Database, kind: Kind, verb: string, args: string[], flags: Flags): Promise<Out> {
  const id = args[0];
  const by = () => actor(db, flags);
  const needId = () => need(id, 'id (first argument)');
  switch (verb) {
    case 'stu': {
      const who = await by();
      return await runItemCommand({ db, noun: kind, verb: 'stu', id, flags, actor: who });
    }
    case 'add': {
      if (flags.item !== undefined) {
        const who = await by();
        return await runItemCommand({ db, noun: kind, verb: 'add', id: needId(), flags, actor: who });
      }
      const r = addAsk(db, toExactOptional({
        kind,
        id: needId(),
        title: need(flags.title, 'title'),
        question: need(flags.question, 'question'),
        body: await readText(flags.body, flags['body-file'], 'body'),
        issues: list(flags.issues),
        forSession: flags.for ?? null,
        order: flags.order === undefined ? undefined : intFlag(flags.order, 'order'),
        actor: await by(),
      }));
      const words = {
        added: 'Filed. It waits in the queue.',
        requeued: 'Back in the queue.',
        reasked: 'New question on a settled id: back in the queue as a new round.',
        updated: 'Updated in place.',
        noop: 'Nothing to do.',
      }[r.result];
      return { data: { result: r.result, note: r.note ?? null, [kind]: r.ask }, text: `${askLine(r.ask)}\n${words}${r.note ? ` ${r.note}` : ''}` };
    }
    case 'open': {
      const a = openAsk(db, toExactOptional({ kind, id, force: Boolean(flags.force), actor: await by() }));
      return { data: { [kind]: a }, text: `Opened. The owner has the floor.\n\n${askFull(a)}` };
    }
    case 'answer': {
      const askID = needId();
      const text = await readText(flags.answer, flags['answer-file'], 'answer');
      const who = await by();
      const input = { id: askID, kind, answer: text, actor: who };
      const answered = kind === 'call' ? await runCallAnswer(db, input, () => readOwnerSession(db, readOwnerProbeDeps())) : answerAsk(db, input);
      return { data: { [kind]: answered }, text: `${askLine(answered)}\nAnswer saved word for word. Apply it, then: hq ${kind} apply ${answered.id} --to ...` };
    }
    case 'apply': {
      const a = applyAsk(db, needId(), kind, need(flags.to, 'to'), flags.note ?? null, await by());
      return { data: { [kind]: a }, text: `${askLine(a)}\nApplied. The floor is free.` };
    }
    case 'later': {
      const a = laterAsk(db, needId(), kind, flags.until ?? null, await by());
      return { data: { [kind]: a }, text: `${askLine(a)}\nShelved until ${a.due_at}.` };
    }
    case 'skip': {
      const a = skipAsk(db, needId(), kind, flags.reason ?? null, await by());
      return { data: { [kind]: a }, text: `${askLine(a)}\nSkipped. It returns when its filer adds it again.` };
    }
    case 'close': {
      const a = closeAsk(db, needId(), kind, need(flags.reason, 'reason'), await by());
      return { data: { [kind]: a }, text: `${askLine(a)}\nClosed: it no longer needs the owner.` };
    }
    case 'show': {
      const a = getAsk(db, needId());
      if (!a || a.kind !== kind) throw new HqError('not_found', `no ${kind} with id ${id}`);
      const h = flags.history ? history(db, 'ask', a.id) : undefined;
      const htext = h ? `\n\nhistory:\n${(h as { at: string; action: string; actor: string }[]).map((e) => `  ${e.at} ${e.action} by ${e.actor}`).join('\n')}` : '';
      return { data: { [kind]: a, ...(h ? { history: h } : {}) }, text: askFull(a) + htext };
    }
    case 'list': {
      const asked = pickAskStates(flags.state),
        rows = listAsks(db, toExactOptional({ kind, states: asked }));
      return { data: { [`${kind}s`]: rows }, text: rows.length ? rows.map(askLine).join('\n') : `No ${kind}s here.` };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq ${kind} ${verb}`);
  }
}

async function unblockCommand(db: Database, verb: string, args: string[], flags: Flags): Promise<Out> {
  const by = () => actor(db, flags);
  switch (verb) {
    case 'later': {
      const who = await by();
      return await runItemCommand({ db, noun: 'unblock', verb: 'later', id: args[0], flags, actor: who });
    }
    case 'add': {
      if (flags.item !== undefined) {
        const who = await by();
        return await runItemCommand({ db, noun: 'unblock', verb: 'add', id: undefined, flags, actor: who });
      }
      const r = addUnblock(db, {
        id: flags.id ?? null,
        task: need(flags.task, 'task'),
        minutes: intFlag(flags.minutes, 'minutes'),
        unblocks: parseUnblocks(flags.unblocks ?? ''),
        rank: flags.rank === undefined ? undefined : intFlag(flags.rank, 'rank'),
        notify: list(flags.notify),
        doneWhen: (flags['done-when'] ?? []).map((raw) => parseDoneWhen(raw)),
        ...parseWatchFlags(flags.kind, flags.deadline),
        actor: await by(),
      });
      const warn = r.warnings.map(
        (w) => `warning: ${w.issue} was already on the list as ${w.id} (${w.state}${w.closed_at ? ` ${w.closed_at.slice(0, 10)}` : ''}): ${w.task}`,
      );
      return { data: { result: r.result, item: r.item, warnings: r.warnings }, text: [unblockLine(r.item), r.result, ...warn].join('\n') };
    }
    case 'list': {
      const state = (flags.state ?? 'open') as 'open' | 'done' | 'dropped' | 'all';
      const items = listUnblocks(db, state);
      return { data: { items: items.map((item) => ({ ...item, recheck: isRecheck(item, now()), overdue: isOverdue(item, now()) })) }, text: items.length > 0 ? items.map((item) => unblockLine(item)).join('\n') : 'Nothing needs the owner\'s hands. Remarkable.' };
    }
    case 'new': {
      const items = newSincePush(db);
      return {
        data: { cursor: pushedSeq(db), upto: uptoFor(items, db), items },
        text: items.length
          ? `${items.length} new since the last push:\n${items.map(unblockLine).join('\n')}\nAfter you push them: hq unblock pushed --upto ${uptoFor(items, db)}`
          : 'Nothing new since the last push.',
      };
    }
    case 'pushed': {
      const r = markPushed(db, intFlag(need(flags.upto, 'upto (from hq unblock new)'), 'upto')!, await by());
      return { data: r, text: `Cursor moved: ${r.covered} item${r.covered === 1 ? '' : 's'} marked as pushed.` };
    }
    case 'done':
    case 'drop': {
      const u = closeUnblock(db, need(args[0], 'id (first argument)'), verb === 'done' ? 'done' : 'dropped', flags.note ?? null, await by());
      return { data: { item: u }, text: `${unblockLine(u)}\n${verb === 'done' ? 'Done. Nice work.' : 'Dropped.'}` };
    }
    case 'rank': {
      const raw = need(args[1], 'rank (second argument: N or none)');
      const u = rankUnblock(db, need(args[0], 'id (first argument)'), intFlag(raw, 'rank'), await by());
      return { data: { item: u }, text: unblockLine(u) };
    }
    case 'done-when': {
      const conditions = args.slice(1).map((raw) => parseDoneWhen(raw));
      if (conditions.length === 0) {
        throw new HqError('bad_args', 'hq unblock done-when <id> <issue:GEO-1|pr:repo#1|doc:ID|release:repo|date:ISO>...');
      }
      const who = await by();
      const item = addDoneWhen(db, need(args[0], 'id (first argument)'), conditions, who);
      return { data: { item }, text: unblockLine(item) };
    }
    case 'show': {
      const u = getUnblock(db, need(args[0], 'id (first argument)'));
      if (!u) throw new HqError('not_found', `no unblock item ${args[0]}`);
      const h = flags.history ? history(db, 'unblock', u.id) : undefined;
      return { data: { item: { ...u, recheck: isRecheck(u, now()), overdue: isOverdue(u, now()) }, ...(h ? { history: h } : {}) }, text: unblockLine(u) };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq unblock ${verb}`);
  }
}

// One watcher tick for running work: read new notes from atc, then sweep.
async function watchRuns(db: Database, me: string): Promise<void> {
  const c = await AtcClient.open();
  try {
    const ing = await ingestNotes(db, c);
    if (ing.notes > 0 || ing.routed > 0 || ing.reset || ing.bootstrapped) {
      console.log(`${iso(now())} notes: ${ing.notes} recorded${ing.routed ? `, ${ing.routed} routed to ${orchestratorName()}` : ''}${ing.finals.length > 0 ? `, final: ${ing.finals.join(', ')}` : ''}${ing.reset ? ', feed cursor reset' : ''}${ing.bootstrapped ? ', feed cursor started at the end' : ''}`);
    }
    const sw = await sweepNow(db, c, boundedRunner(realRunner, CALL_MS), me);
    if (sw.sent.length) console.log(`${iso(now())} sweep: told ${orchestratorName()} about ${sw.sent.map((a) => a.key).join(', ')}`);
  } finally {
    c.close();
  }
}

function runLine(r: RunView): string {
  const s = r.sessions.find((x) => x.active === 1 && !x.helper);
  const helpers = r.sessions.filter((x) => x.active === 1 && x.helper).map((x) => x.session_id.slice(0, 8));
  const sess = `${s ? `${s.session_id.slice(0, 8)} (${r.place})` : 'no session'}${helpers.length ? ` + helper ${helpers.join(', ')}` : ''}`;
  const prs = r.prs.length
    ? r.prs
        .map((pr) => `${pr.ref} ${formatPRTag(pr)}`)
        .join(', ')
    : 'none yet';
  const extra = [r.live_check ? `live check: ${r.live_check}` : null, r.gate ? `gate: ${r.gate}` : null, r.waits_on ? `waits on ${r.waits_on}` : null, r.geoff_chat ? 'the owner chats' : null].filter(Boolean).join('; ');
  return `| ${sess}${r.lane ? ` ${r.lane}` : ''} | ${r.issue} ${r.title} [${r.state}] | ${prs} | ${r.next}${extra ? ` (${extra})` : ''} |`;
}

async function expandSession(raw: string): Promise<string> {
  let client: AtcClient | null = null;
  try {
    return await fullSessionId(async () => {
      client = await AtcClient.open();
      return client.sessions();
    }, raw);
  } finally {
    (client as AtcClient | null)?.close();
  }
}

// The atc connection opens only when a session needs it, and closes after.
async function runDoneWrapUp(db: Database, issue: string, actorName: string): Promise<WrapUp> {
  const opened: AtcClient[] = [];
  const deps: WrapUpDeps = {
    openClient: async () => {
      const atc = await AtcClient.open();
      opened.push(atc);
      const fleetClient = makeFleetClient(atc);
      if (!hasStaleOps(fleetClient)) {
        throw new HqError('internal', 'the atc client lacks stop, unpin and forget');
      }
      return fleetClient;
    },
    readImpWork: (session) => readImpWork(realRunner, session.id, session.cwd),
  };
  try {
    return await runWrapUp(db, deps, issue, actorName);
  } finally {
    for (const atc of opened) {
      atc.close();
    }
  }
}

async function runCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  const by = () => actor(db, flags);
  const arg = (i: number, what: string) => need(args[i], what);
  const view = (issue: string) => viewRun(db, getRun(db, issue)!);
  switch (verb) {
    case 'add': {
      // A second word was a session id once dropped without a word, so the run had no session and
      // its notes, FINALs among them, never matched it.
      if (args.length > 1) {
        throw new HqError('bad_args', `hq run add takes one issue: pass the session as --session ${args[1]}`);
      }
      const where = (flags.where ?? 'imp') as 'local' | 'imp' | 'none';
      if (!['local', 'imp', 'none'].includes(where)) throw new HqError('bad_args', '--where must be local, imp or none');
      const r = addRun(db, {
        issue: arg(0, 'issue'),
        title: need(flags.title, 'title'),
        place: where,
        session: flags.session ? await expandSession(flags.session) : null,
        next: flags.next ?? 'Agent working.',
        gate: flags.gate ?? null,
        geoffChat: !!flags['geoff-chat'],
        readySince: flags['ready-since'] ?? null,
        size: parseSize(flags.size, flags.lines),
        lane: flags.lane ? checkLane(await readLanes(), flags.lane) : null,
        actor: await by(),
      });
      return { data: { result: r.result, run: r.run }, text: `${runLine(r.run)}
${r.result === 'added' ? 'On the board.' : 'Already on the board.'}` };
    }
    case 'size': {
      const issue = resolveRun(db, arg(0, 'issue')).issue;
      const guess = parseSize(need(flags.size, 'size'), need(flags.lines, 'lines'))!;
      setSize(db, issue, guess, await by());
      return { data: { run: view(issue) }, text: `${issue}: ${guess.size}, about ${guess.lines.toLocaleString('en-AU')} lines` };
    }
    case 'session': {
      if (flags.add && flags.remove) throw new HqError('bad_args', 'give --add or --remove, not both');
      const raw = arg(1, 'session id');
      const r = setSession(db, arg(0, 'issue'), flags.remove ? await expandSession(raw).catch(() => raw.toLowerCase()) : await expandSession(raw), await by(), flags.add ? 'add' : flags.remove ? 'remove' : 'main');
      return { data: { run: r }, text: runLine(r) };
    }
    case 'lane': {
      const a = laneArgs(args, flags.lane);
      const issue = resolveRun(db, a.key).issue;
      setRunLane(db, issue, checkLane(await readLanes(), a.lane), await by());
      return { data: { run: view(issue) }, text: runLine(view(issue)) };
    }
    case 'reopen': {
      // A done or dropped run that work started on again: back to working, sessions and PRs kept.
      const prev = resolveRun(db, arg(0, 'issue'));
      if (prev.state !== 'done' && prev.state !== 'dropped') throw new HqError('bad_state', `${prev.issue} is ${prev.state}, not done or dropped: nothing to reopen`);
      const r = setState(db, prev.issue, 'working', { next: flags.next ?? 'Reopened: agent working.', reopen: true }, await by());
      return { data: { run: r }, text: `${runLine(r)}\nReopened.` };
    }
    case 'state': {
      const refusal = readMoveRefusal(db, arg(0, 'issue'), arg(1, 'state'), flags.force === true);
      if (refusal !== null) {
        throw new HqError('bad_state', refusal);
      }
      const [issue, state] = [arg(0, 'issue'), arg(1, 'state')],
        actorName = await by(),
        r = setState(db, issue, state, toExactOptional({ liveCheck: flags.check as LiveCheck | undefined, next: flags.next, waitsOn: parseWaitsOn(flags['waits-on']), note: flags.note ?? null, reopen: Boolean(flags.reopen), waitsOnGeoff: parseGeoffFlag(flags) }), actorName);
      return { data: { run: r }, text: runLine(r) };
    }
    case 'check': {
      const r = setLiveCheck(db, resolveRun(db, arg(0, 'issue')).issue, arg(1, 'owed or none'), await by());
      return { data: { run: r }, text: runLine(r) };
    }
    case 'ship': {
      const r = await shipRuns(db, boundedRunner(realRunner, CALL_MS), now(), { dryRun: !!flags['dry-run'] });
      const head = r.dryRun ? 'Would move' : 'Moved';
      const text = [
        r.moved.length ? `${head}:` : `${r.dryRun ? 'Would move' : 'Moved'} nothing.`,
        ...r.moved.map((move) => `  ${move.issue} -> ${move.to}: ${move.prs.map((pr) => `${pr.ref} ${formatShippedAt(pr.tag)} (${pr.shipped_at})`).join(', ')}`),
        `${r.shippedPrs} PR(s) ${r.dryRun ? 'found' : 'newly marked'} shipped; ${r.compares} compare call(s)${r.deferred ? `; ${r.deferred} PR(s) left for the next pass` : ''}.`,
        ...r.held.map((issue) => `  left held: ${issue} was put in deploy-held after the release that holds its PRs`),
        ...r.busy.map((left) => `  left: ${left.issue} has session ${left.session.slice(0, 8)} still active`),
        ...r.errors.map((e) => `  error: ${e}`),
      ].join('\n');
      if (!r.dryRun) setMeta(db, CHECKED_AT, iso(now()));
      return { data: { ...r }, text };
    }
    case 'done': {
      const actorName = await by();
      const closed = setState(db, arg(0, 'issue'), 'done', { note: flags.note ?? flags.reason ?? null }, actorName);
      const wrapUp = await runDoneWrapUp(db, closed.issue, actorName);
      return { data: { run: closed, wrapUp }, text: `${runLine(closed)}\n${formatWrapUp(wrapUp)}\nDone. Off the board.` };
    }
    case 'drop': {
      const actorName = await by();
      const dropped = setState(db, arg(0, 'issue'), 'dropped', { note: flags.note ?? flags.reason ?? null }, actorName);
      return { data: { run: dropped }, text: `${runLine(dropped)}\nDropped.` };
    }
    case 'next':
    case 'gate':
    case 'title': {
      const value = arg(1, verb);
      const r = setField(db, arg(0, 'issue'), verb, verb === 'gate' && value === 'none' ? null : value, await by());
      return { data: { run: r }, text: runLine(r) };
    }
    case 'place': {
      const actorName = await by();
      const placed = setPlace(db, { issue: arg(0, 'issue'), place: arg(1, 'place (imp, local or none)'), note: flags.note ?? null, actor: actorName });
      if (!placed.ok) {
        throw new HqError('bad_args', placed.refusal);
      }
      return { data: { run: placed.run }, text: `${runLine(placed.run)}\nNow ${placed.run.place}.` };
    }
    case 'geoff-chat': {
      const r = setGeoffChat(db, arg(0, 'issue'), arg(1, 'on or off') === 'on', await by());
      return { data: { run: r }, text: runLine(r) };
    }
    case 'pr': {
      const p = addPr(db, arg(0, 'issue'), arg(1, 'pr (repo#n or URL)'), await by());
      return { data: { pr: p }, text: runLine(view(p.issue)) };
    }
    case 'final': {
      const p = finalPr(db, arg(0, 'pr'), need(flags.sha, 'sha'), await by(), { fixed: parseFixed(flags.fixed), followups: parseFollowups(flags.followups) });
      return { data: { pr: p }, text: runLine(view(p.issue)) };
    }
    case 'unfinal': {
      const p = unfinalPr(db, arg(0, 'pr'), await by(), flags.reason ?? null);
      return { data: { pr: p }, text: runLine(view(p.issue)) };
    }
    case 'reviewing': {
      const p = reviewStarted(db, arg(0, 'pr'), await by());
      return { data: { pr: p }, text: runLine(view(p.issue)) };
    }
    case 'reviewed': {
      const p = reviewedPr(db, arg(0, 'pr'), need(flags.sha, 'sha'), { recheck: !!flags.recheck, force: !!flags.force }, await by());
      return { data: { pr: p }, text: `${runLine(view(p.issue))}
Round ${p.review_round} recorded at ${p.reviewed_sha}.` };
    }
    case 'unmerge': {
      const p = unmergePr(db, arg(0, 'pr'), await by(), flags.reason ?? null);
      return { data: { pr: p }, text: runLine(view(p.issue)) };
    }
    case 'merged':
    case 'closed': {
      // The watcher may have marked it merged already: the call then succeeds and changes nothing.
      const already = verb === 'merged' ? readMergedPR(db, arg(0, 'pr')) : null;
      if (already) {
        return { data: { pr: already }, text: runLine(view(already.issue)) };
      }
      if (verb === 'merged') await checkMergedOnGitHub(boundedRunner(realRunner, CALL_MS), arg(0, 'pr'));
      const closed = closePr(db, arg(0, 'pr'), { to: verb, actor: await by() });
      return { data: { pr: closed }, text: runLine(view(closed.issue)) };
    }
    case 'note': {
      const n = addNote(db, arg(0, 'issue or session'), arg(1, 'text'), flags.label ?? null, await by());
      return { data: { note: n }, text: runLine(view(n.issue)) };
    }
    case 'show': {
      const r = viewRun(db, resolveRun(db, arg(0, 'issue or session')));
      const notes = notesFor(db, r.issue, intFlag(flags.notes, 'notes') ?? 5);
      const text = [runLine(r), ...r.sessions.map((s) => `  ${s.helper ? 'helper' : 'session'} ${s.session_id}${s.active ? ' (active)' : ` (ended ${s.ended_at})`}`), ...notes.map((n) => `  ${n.at} [${n.source}${n.label ? `/${n.label}` : ''}] ${n.text.replace(/\s+/g, ' ').slice(0, 200)}`)].join('\n');
      return { data: { run: r, notes }, text };
    }
    case 'list':
    case undefined: {
      const rows = listRuns(db, !!flags.all);
      const byLane = runningByLane(db);
      const counts = Object.entries(byLane).map(([l, n]) => `${l || 'no lane'} ${n}`).join(', ');
      const text = rows.length ? ['| Session | Issue | PR | Next |', '|---|---|---|---|', ...rows.map(runLine), '', `Running by lane: ${counts || 'none'}`].join('\n') : 'The board is clear.';
      return { data: { runs: rows, runningByLane: byLane }, text };
    }
    case 'watchlist': {
      const w = watchlist(db);
      const body = w.map((x) => `${x.session_id} ${x.issue}`).join('\n');
      if (flags.write) await Bun.write(flags.write, body ? `${body}\n` : '');
      return { data: { sessions: w, written: flags.write ?? null }, text: body || '(no active sessions)' };
    }
    case 'sweep': {
      const c = await AtcClient.open();
      try {
        const ing = await ingestNotes(db, c);
        const sweeper = await by();
        const sw = await sweepNow(db, c, boundedRunner(realRunner, CALL_MS), sweeper);
        return {
          data: { ingest: ing, alerts: sw.alerts, sent: sw.sent },
          text: [`notes recorded: ${ing.notes}`, sw.alerts.length ? sw.alerts.map((a) => `- ${a.line}`).join('\n') : 'Nothing to flag.', sw.sent.length ? `(told ${orchestratorName()} about ${sw.sent.length})` : ''].filter(Boolean).join('\n'),
        };
      } finally {
        c.close();
      }
    }
    default:
      throw new HqError('bad_args', `unknown command: hq run ${verb}`);
  }
}

function realProbe(db: Database): Probe {
  return {
    // coreutils timeout kills a hung check, so a stuck systemctl or df never piles up.
    run: (cmd, opts) => realRunner(['timeout', '-k', '2', '15', ...cmd], { ...opts, env: cleanEnv() }),
    readFile: (path) => Bun.file(path).text(),
    atcAnswers: async () => {
      try {
        const c = await AtcClient.open();
        try {
          await c.request('session.list');
          return null;
        } finally {
          c.close();
        }
      } catch (e) {
        return String((e as Error).message ?? e);
      }
    },
    home: process.env['HOME'] ?? '/',
    backup: () => {
      const l = lastBackup(db);
      return { lastOk: l.lastOk, lastError: l.last && !l.last.ok ? l.last.error : null, everRan: l.last !== null };
    },
    morning: (at) => morningCheck(db, at),
    goalsDaily: (at) => goalsDailyCheck(db, at),
    goalsWeekly: (at) => goalsWeeklyCheck(db, at),
    defsTree: (at) => readTreeCheck(db, at),
    privateTree: (at) => readTreeCheck(db, at, 'private'),
    fleetTrust: () => fleetTrustChecks(declaredFleet(db)),
    stuckSaves: (at) => readStuckSaveChecks(db, at),
    probe: (at) => probeHealth(db, at),
    localConfig: () => readLocalConfigCheck(),
    watcher: (at) => {
      const w = watcherState(db, at);
      return w.since === null ? null : { key: 'watcher-tick', ok: !w.stale, line: `hq watcher: last completed tick ${w.lastTick ?? 'none'}${w.minutes !== null ? ` (${w.minutes} min ago)` : ''}` };
    },
    defsFetch: () => readFetchCheck(db),
  };
}

// What the capacity watch reads from: impz and df under a deadline, the tailnet metrics page, /proc.
// The watcher's capacity step; also `hq capacity sample`.
async function capacityTick(db: Database, actor: string) {
  const r = await runCapacityStep(db, buildCapacityProbe(), pacingPath(), actor);
  return { ...r, opened: r.tick.opened, cleared: r.tick.cleared };
}

async function capacityCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  switch (verb) {
    case undefined:
    case 'show': {
      const reading = await latestSample(db);
      const open = openAlerts(db);
      const lines = [reading ? readingText(reading) : 'No sample yet: hq capacity sample reads one now.', 'Thresholds:', ...thresholdLines(db, reading).map((l) => `  ${l}`), Object.keys(open).length ? 'Open alerts:' : 'No open alerts.', ...Object.values(open).map((o) => `  ${o.line} (since ${o.since}${o.told ? '' : ', not yet told'})`)];
      const pacing = await loadPacing(pacingPath());
      const hint = readCapacityHint(db, pacing.claudeLaunchPct ?? 95, now());
      return { data: { sample: reading, hint, settings: capacitySettings(db), open }, text: [...lines, ...formatCapacityHint(hint)].join('\n') };
    }
    case 'sample': {
      const r = await capacityTick(db, await actor(db, flags));
      return { data: { sample: r.reading, opened: r.tick.opened, cleared: r.tick.cleared, told: r.tick.told }, text: `${readingText(r.reading)}\n${r.tick.opened.length} opened, ${r.tick.cleared.length} cleared.` };
    }
    case 'log': {
      const hours = flags.hours === undefined ? 24 : intFlag(flags.hours, 'hours');
      if (hours === null || hours < 1 || hours > 24 * 30) throw new HqError('bad_args', '--hours must be a whole number from 1 to 720');
      const rows = await sampleLog(db, hours);
      const f = (x: number | null, div: number, d = 0) => (x === null ? '-' : (x / div).toFixed(d));
      return { data: { samples: rows }, text: rows.length ? rows.map((r) => `${r.at}  non-Nix ${f(r.nonnix_awake_mib, 1)} MiB  cloud ${f(r.cloud_avail_bytes, 2 ** 30, 1)} GiB  Claude 5h ${f(r.claude_five_hour, 1)}% 7d ${f(r.claude_seven_day, 1)}%  CI ${f(r.ci_minutes_today, 1)} min${Object.keys(r.errors).length ? `  ! ${Object.keys(r.errors).join(',')}` : ''}`).join('\n') : `No samples in the last ${hours} h.` };
    }
    case 'set': {
      const key = need(args[0], 'setting name');
      if (flags.reset && args[1] !== undefined) throw new HqError('bad_args', 'give a VALUE or --reset, not both');
      if (!flags.reset && args[1] === undefined) throw new HqError('bad_args', 'give a VALUE, or --reset for the default');
      const settings = setCapacitySetting(db, key, flags.reset ? null : args[1]!, await actor(db, flags));
      return { data: { settings }, text: `${key} = ${settings[key as keyof typeof settings]}${flags.reset ? ' (default)' : ''}` };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq capacity ${verb}`);
  }
}

// The watcher's health step; also `hq health tick`.
async function healthTick(db: Database, actor: string) {
  const { checks, samples, unknown } = await runChecks(realProbe(db), healthSettings(db), healthSamples(db), now());
  return applyHealth(db, checks, samples, actor, unknown);
}

async function healthCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  switch (verb) {
    case undefined:
    case 'check': {
      // On demand: read only. The watcher keeps the samples and sends the alerts.
      const { checks } = await runChecks(realProbe(db), healthSettings(db), healthSamples(db), now());
      const open = openProblems(db);
      const bad = checks.filter((c) => !c.ok);
      const lines = [bad.length ? `${bad.length} problem(s):` : 'All checks pass.', ...bad.map((c) => `  ✗ ${c.line}${open[c.key] ? ` (told ${open[c.key]!.since})` : ''}`), ...checks.filter((c) => c.ok).map((c) => `  ✓ ${c.line}`)];
      return { data: { healthy: bad.length === 0, checks, open }, text: lines.join('\n') };
    }
    case 'tick': {
      const r = await healthTick(db, await actor(db, flags));
      return { data: { ...r }, text: `${r.checks.filter((c) => !c.ok).length} problem(s); ${r.opened.length} new (told ${owner()}); ${r.cleared.length} cleared.` };
    }
    case 'settings':
      return { data: { settings: healthSettings(db) }, text: Object.entries(healthSettings(db)).map(([k, v]) => `${k} = ${v}`).join('\n') };
    case 'set': {
      const key = need(args[0], 'setting name');
      const settings = setHealthSetting(db, key, args[1] ?? null, await actor(db, flags));
      return { data: { settings }, text: `${key} = ${settings[key as keyof typeof settings]}${args[1] === undefined ? ' (default)' : ''}` };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq health ${verb}`);
  }
}

// "7d", "36h", or a time.
function sinceArg(raw: string | undefined, to: Date): string {
  const v = raw ?? '7d';
  const m = /^(\d+)([dh])$/.exec(v);
  if (m) return iso(new Date(to.getTime() - Number(m[1]) * (m[2] === 'd' ? 86_400_000 : 3_600_000)));
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new HqError('bad_args', '--since must be like 7d, 36h or a time');
  return iso(new Date(t));
}

const GH_CACHE = z.object({ day: z.string(), at: z.string(), merges: z.array(z.object({ repo: z.string(), mergedAt: z.string() })) });

// Every merged zgeoff PR since `from`, from GitHub; cached 30 min. null when gh fails.
async function ghMerges(db: Database, from: string, run: Runner = realRunner): Promise<GhMerge[] | null> {
  const day = from.slice(0, 10);
  const c = metaJson(db, 'stats_gh_cache', GH_CACHE.nullable(), null);
  if (c && c.day <= day && Date.now() - Date.parse(c.at) < 30 * 60_000) return c.merges;
  const r = await run(['gh', 'search', 'prs', '--owner', 'zgeoff', '--merged', '--merged-at', `>=${day}`, '--json', 'repository,closedAt', '--limit', '1000'], { env: cleanEnv() });
  if (r.code !== 0) return null;
  try {
    const rows = JSON.parse(r.stdout) as { closedAt: string; repository: { name: string } }[];
    const merges = rows.map((x) => ({ repo: x.repository.name, mergedAt: x.closedAt }));
    setMeta(db, 'stats_gh_cache', JSON.stringify({ day, at: new Date().toISOString(), merges }));
    return merges;
  } catch {
    return null;
  }
}

const KIND_WEEKS = 8;

async function kindsCommand(db: Database, verb: string | undefined, flags: Flags): Promise<Out> {
  const weeks = intFlag(flags.weeks, 'weeks') ?? KIND_WEEKS;
  if (weeks < 1 || weeks > 104) throw new HqError('bad_args', '--weeks must be 1 to 104');
  switch (verb) {
    case undefined:
    case 'list': {
      const w = kindWeeks(db, weeks);
      return { data: { weeks: w, linear: linearState(db) }, text: kindText(w, linearState(db)).join('\n') };
    }
    case 'sync': {
      // The backfill: every day in the window not yet fetched, one gh search a day.
      const kinds = await syncKinds(db, realRunner, { from: weeksBack(weeks), maxDays: weeks * 7 + 2, env: cleanEnv() }),
        linear = await syncLinear(db, makeAuditedLinearCaller(db, realRunner), weeksBack(weeks)).catch((error: unknown) => ({ error: String((error as Error).message ?? error) })),
        said = 'error' in linear ? `Linear failed: ${linear.error}` : `Linear: ${linear.closed} closed issue(s), ${linear.typed} PR issue(s) typed.`,
        w = kindWeeks(db, weeks);

      // As the watcher does: the daily check-in trusts kinds_ok_at.
      if (!kinds.left) {
        setMeta(db, 'kinds_ok_at', new Date().toISOString());
      }
      return { data: { ...kinds, linear, weeks: w }, text: `Fetched ${kinds.days.length} day(s), ${kinds.prs} merged PR(s). ${said}\n${kindText(w, linearState(db)).join('\n')}` };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq kinds ${verb}`);
  }
}

async function goalsCommand(db: Database, verb: string | undefined, rest: string[], flags: Flags): Promise<Out> {
  const days = intFlag(flags.days, 'days') ?? 14;
  if (days < 1 || days > 120) throw new HqError('bad_args', '--days must be 1 to 120');
  switch (verb) {
    case undefined:
    case 'list': {
      const g = goalRows(db, days);
      return { data: { ...g }, text: goalsText(g, true).join('\n') };
    }
    case 'sync': {
      // The backfill: every repo's runs for each UTC day not yet fetched, and closed PRs.
      const r = await syncGoals(db, boundedRunner(realRunner, CALL_MS), { from: new Date(Date.now() - (days + 1) * 86_400_000), env: cleanEnv() }),
        spendFailure = await refreshActionsSpend(db, boundedRunner(realRunner, CALL_MS), now(), cleanEnv());
      if (!r.errors.length && !r.deployLeft) setMeta(db, 'goals_ok_at', new Date().toISOString());
      const g = goalRows(db, days);
      const errs = r.errors.length ? `\n${r.errors.length} fetch(es) failed, retried next sync: ${r.errors.slice(0, 3).join('; ')}` : '';
      return { data: { ...r, ...g, spendFailure }, text: `Fetched ${r.days} repo-day(s): ${r.runs} run(s), ${r.closed} closed PR(s), ${r.deployRuns} deploy-prod run(s) classified${r.deployLeft ? ` (${r.deployLeft} left for the next sync)` : ''}.${errs}${spendFailure === null ? '' : `\nActions spend unknown: ${spendFailure}`}\n${goalsText(g, true).join('\n')}` };
    }
    case 'targets': {
      const { targets, overridden } = goalTargets(db);
      return {
        data: { targets, overridden },
        text: GOAL_KEYS.map((k) => `${k.padEnd(9)} ${targetLine(k, targets[k]).padEnd(46)} ${overridden.includes(k) ? 'set by the review' : 'default'}`).join('\n'),
      };
    }
    case 'target': {
      const key = need(rest[0], 'goal');
      const t = setTarget(db, key, need(rest[1], 'operator or none'), rest[2], await actor(db, flags));
      return { data: { key, target: t }, text: `Target for ${key}: ${targetLine(key as (typeof GOAL_KEYS)[number], t)}` };
    }
    case 'daily': {
      const a = await actor(db, flags);
      if (rest[0] === 'skip') {
        const r = skipDaily(db, rest[1] ?? flags.date ?? sydney(now()).date, need(flags.reason, 'reason'), a);
        return { data: { run: r }, text: `Goals check-in for ${r.key}: skipped (${r.detail})` };
      }
      if (rest.length) throw new HqError('bad_args', `unknown command: hq goals daily ${rest[0]}`);
      if (flags['dry-run']) {
        const age = goalsAge(db, now());
        const note = age === null || age > FRESH_MIN ? `\n(goals data is ${age === null ? 'not synced' : `${age} min old`}: the real send needs hq goals sync first)` : '';
        return { data: { dryRun: true, text: dailyText(db) }, text: `${dailyText(db)}${note}` };
      }
      const r = sendDaily(db, a);
      return { data: { run: r }, text: `Told ${owner()}: goals check-in (${r.key})` };
    }
    case 'weekly': {
      const a = await actor(db, flags);
      if (rest[0] === 'skip') {
        const r = skipWeekly(db, rest[1] ?? flags.date ?? sydney(mondayOf(now())).date, need(flags.reason, 'reason'), a);
        return { data: { run: r }, text: `Goals weekly for ${r.key}: skipped (${r.detail})` };
      }
      if (rest.length) throw new HqError('bad_args', `unknown command: hq goals weekly ${rest[0]}`);
      if (flags['dry-run']) {
        const age = goalsAge(db, now());
        const note = age === null || age > FRESH_MIN ? `\n(goals data is ${age === null ? 'not synced' : `${age} min old`}: the real send needs hq goals sync first)` : '';
        const text = weeklyText(db);
        return { data: { dryRun: true, text }, text: `${text}${note}` };
      }
      const r = sendWeekly(db, a);
      return { data: { run: r }, text: `Told ${owner()}: goals weekly (${r.key})` };
    }
    case 'account': {
      if (rest.length === 0) {
        const labels = accountLabels(db);
        return { data: { labels }, text: Object.keys(labels).length ? Object.entries(labels).map(([k, v]) => `${k} ${v}`).join('\n') : 'No account has a name yet: hq goals account <key> <name>' };
      }
      const key = need(rest[0], 'account key');
      const name = setAccountLabel(db, key, need(rest[1], 'name or none'), await actor(db, flags));
      return { data: { key, name }, text: name ? `Account ${key} is named ${name}` : `Account ${key} has no name` };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq goals ${verb}`);
  }
}

// The window's answers for the weekly audit, which reads them with --json.
function runAnswersCommand(db: Database, flags: Flags): Out {
  const at = now(),
    window = { from: sinceArg(flags.since, at), to: iso(at) },
    windowAnswers = loadAnswers(db, window);
  return { data: { window, answers: windowAnswers }, text: windowAnswers.length > 0 ? windowAnswers.map((a) => formatAnswerLine(a)).join('\n') : `No answers since ${window.from}.` };
}

async function statsCommand(db: Database, flags: Flags): Promise<Out> {
  const t = now();
  if (flags.around) {
    const m = getMark(db, intFlag(flags.around, 'around')!);
    if (!m) throw new HqError('not_found', `no mark ${flags.around}`);
    const at = Date.parse(m.at);
    const week = 7 * 86_400_000;
    const before = computeStats(db, { from: iso(new Date(at - week)), to: m.at, gh: null });
    const after = computeStats(db, { from: m.at, to: iso(new Date(Math.min(at + week, t.getTime()))), gh: null });
    return { data: { mark: m, before, after }, text: compareText(m, before, after) };
  }
  const from = sinceArg(flags.since, t);
  const s = computeStats(db, { from, to: iso(t), gh: await ghMerges(db, from) });
  const merged = mergedRuns(db, from, iso(t));
  const facts = await prFacts(db, realRunner, merged.flatMap((r) => r.prs), cleanEnv());
  const sizes = facts ? sizeStats(merged, facts) : null;
  const marks = listMarks(db, s.window.from);
  const reviews = reviewStats(db, t);
  // Up to 3 days not fetched yet; the watcher and hq kinds sync keep the rest.
  await syncKinds(db, realRunner, { from: weeksBack(KIND_WEEKS, t), maxDays: 3, env: cleanEnv() }, t).catch(() => null);
  const kinds = kindWeeks(db, KIND_WEEKS, t);
  const goals = goalRows(db, 14, t);
  const text = `${statsText(s)}\n\n${sizeText(sizes).join('\n')}\n\n${reviewText(reviews).join('\n')}\n\n${kindText(kinds, linearState(db)).join('\n')}\n\n${goalsText(goals, false).join('\n')}\n  (by day: hq goals)${marks.length ? `\n\nMarks in the window (hq stats --around ID):\n${marks.map((m) => `  ${m.id} ${m.at} [${m.kind}] ${m.text}`).join('\n')}` : ''}`;
  return mergeAnswerWeeks({ data: { stats: s, sizes, reviews, kinds, goals: goals.weeks, marks }, text }, countAnswerWeeks(db, 4, t));
}

// The target as atc knows it now; the line is still recorded when atc can't say.
async function resolveTarget(raw: string): Promise<{ id: string | null; name: string | null }> {
  let client: AtcClient | null = null;
  try {
    const key = /^[0-9a-f-]{4,}$/i.test(raw) ? await expandSession(raw) : raw;
    client = await AtcClient.open(undefined, 1500);
    const s = await client.resolve(key);
    return { id: s.id, name: s.name };
  } catch (e) {
    if ((e as HqError).code === 'atc_protocol_mismatch') throw e;
    return { id: null, name: null };
  } finally {
    (client as AtcClient | null)?.close();
  }
}

async function typedCommand(db: Database, verb: string | undefined, flags: Flags): Promise<Out> {
  const line = (t: Typed) => `${t.id} ${t.at} → ${t.to_name ?? t.to_session}${t.to_id ? ` (${t.to_id.slice(0, 8)})` : ' (not resolved)'} by ${t.typed_by}, from ${typedSource(t)}\n    ${t.text.replaceAll('\n', '\n    ')}`;
  switch (verb) {
    case 'add': {
      const to = need(flags.to, 'to');
      const source = parseSource(db, need(flags.source, 'source'));
      if (source.kind === 'chat') source.ref = await expandSession(source.ref).catch(() => source.ref); // the full id when atc knows it
      const text = await readText(flags.text, flags['text-file'], 'text');
      const target = await resolveTarget(to);
      const t = addTyped(db, { to, toId: target.id, toName: target.name, text, source, actor: await actor(db, flags) });
      return { data: { typed: t }, text: `Logged ${t.id}: ${t.to_name ?? t.to_session}${t.to_id ? '' : ' (atc could not resolve it; kept as given)'}, from ${typedSource(t)}` };
    }
    case 'list':
    case undefined: {
      const ts = listTyped(db, { session: flags.session ?? null, limit: flags.limit ? intFlag(flags.limit, 'limit')! : 50 });
      return { data: { typed: ts }, text: ts.length ? ts.map(line).join('\n') : 'No typed lines.' };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq typed ${verb}`);
  }
}

async function defsCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  const lines = (cs: { ok: boolean; line: string }[]) => cs.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.line}`).join('\n');
  switch (verb) {
    case 'status':
    case undefined: {
      const src = defsSource();
      const dir = DEFS();
      const head = (await realRunner(['git', '-C', dir, 'rev-parse', '--short', 'origin/main'], { env: cleanEnv() })).stdout.trim() || '?';
      const override = config().HQ_DEFINITIONS_DIR ? ' (HQ_DEFINITIONS_DIR overrides it)' : '';
      return { data: { source: src, dir, originMain: head, sources: Object.fromEntries(Object.entries(DEFS_SOURCES).map(([k, v]) => [k, v.dir()])) }, text: `definitions: ${src}${override}\ncheckout: ${dir} (origin/main ${head})\nswitch file: ${defsSourceFile()}` };
    }
    case 'setup': {
      const r = await setupCheckout(realRunner, parseTree(need(args[0], 'tree (hq or private)')));
      return { data: r, text: r.made ? `Cloned into ${r.dir}.` : `${r.dir} is already a checkout.` };
    }
    case 'check': {
      const source = parseDefsSource(args[0] ?? defsSource());
      const cs = preflight(source);
      const bad = cs.filter((c) => !c.ok).length;
      return { data: { source, ready: bad === 0, checks: cs }, text: `${source}: ${bad ? `${bad} problem(s)` : 'ready'}\n${lines(cs)}` };
    }
    case 'sync': {
      const who = await actor(db, flags);
      return runSyncCommand(db, who);
    }
    case 'use': {
      const r = useSource(db, parseDefsSource(need(args[0], 'source (hq)')), await actor(db, flags));
      return { data: r, text: `Definitions: ${r.from} → ${r.to}.\n${lines(r.checks)}\nRunning sessions keep their directory until they restart; the next fleet spawn, wake and lanes tick use ${r.to}.` };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq defs ${verb}`);
  }
}

async function morningCommand(db: Database, verb: string | undefined, flags: Flags): Promise<Out> {
  switch (verb) {
    case 'skip': {
      const r = skipMorning(db, flags.date ?? sydney(now()).date, need(flags.reason, 'reason'), await actor(db, flags));
      return { data: { run: r }, text: `Morning reports for ${r.key}: skipped (${r.detail})` };
    }
    case 'tick': {
      const r = morningTick(db, await actor(db, flags));
      return { data: { run: r }, text: r ? `Told ${owner()}: morning reports due (${r.key})` : 'Nothing to do: not yet 08:15 Sydney, or today already ran.' };
    }
    case 'status':
    case undefined: {
      const rs = recentRuns(db);
      const w = windows(now());
      return {
        data: { runs: rs, next: w },
        text: [`Morning reports, 08:15 Sydney daily. Today's text would be:`, morningText(w, false).replace(/^/gm, '  '), '', ...(rs.length ? rs.map((r) => `${r.key} ${r.result} at ${r.at}${r.detail ? ` (${r.detail})` : ''}${r.result === 'queued' ? `, ${r.sent ?? 'not in the outbox'}` : ''}`) : ['No runs yet.'])].join('\n'),
      };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq morning ${verb}`);
  }
}

async function followupCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  switch (verb) {
    case 'add': {
      const by = await actor(db, flags);
      const followup = flags.backfill ? addBackfill(db, { issue: need(args[0], 'issue'), fromRef: flags.from ?? null, at: need(flags.at, 'at'), actor: by }) : addFollowup(db, { issue: need(args[0], 'issue'), fromRef: need(flags.from, 'from'), actor: by });
      return { data: { followup }, text: `Counted ${followup.issue} (${followup.source}), filed ${followup.filed_at}${followup.from_ref ? ` from ${followup.from_ref}` : ''}` };
    }
    case 'drop': {
      const issue = need(args[0], 'issue');
      if (!dropFollowup(db, issue, await actor(db, flags))) throw new HqError('not_found', `${issue} is not counted`);
      return { data: { dropped: issue }, text: `Dropped ${issue}` };
    }
    case 'list':
    case undefined: {
      const fs = listFollowups(db);
      return { data: { followups: fs }, text: fs.length ? fs.map((f) => `${f.filed_at} ${f.issue} ${f.source}${f.from_ref ? ` from ${f.from_ref}` : ''}`).join('\n') : 'No follow-ups counted.' };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq followup ${verb}`);
  }
}

async function markCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  switch (verb) {
    case 'add': {
      if (flags.grant !== undefined) {
        return runGrantMarkAdd(db, flags);
      }
      const m = addMark(db, { kind: need(flags.kind, 'kind'), text: need(flags.text, 'text'), ref: flags.ref ?? null, at: flags.at ?? null, actor: await actor(db, flags) });
      return { data: { mark: m }, text: `Mark ${m.id} at ${m.at}: ${m.text}` };
    }
    case 'grant': {
      return runMarkGrant(db, args, flags);
    }
    case 'drop': {
      const id = intFlag(need(args[0] ?? flags.id, 'mark id'), 'id')!;
      const m = dropMark(db, id, await actor(db, flags));
      if (!m) throw new HqError('not_found', `no mark ${id}`);
      return { data: { dropped: m }, text: `Dropped mark ${id}: ${m.text}` };
    }
    case 'list':
    case undefined: {
      const ms = listMarks(db, flags.since ? sinceArg(flags.since, now()) : null);
      return { data: { marks: ms }, text: ms.length > 0 ? ms.map((m) => `${m.id} ${m.at} [${m.kind}${m.grant_name === null ? '' : ` ${m.grant_name}`}] ${m.text}${m.ref ? ` ${m.ref}` : ''} (by ${m.added_by})`).join('\n') : 'No marks.' };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq mark ${verb}`);
  }
}

// `hq mark add --kind grant --grant NAME`: a standing grant's mark, named.
async function runGrantMarkAdd(db: Database, flags: Flags): Promise<Out> {
  if (flags.kind !== 'grant') {
    throw new HqError('bad_args', '--grant names a standing grant: give it with --kind grant');
  }
  const by = await actor(db, flags),
    m = createGrantMark(db, { text: need(flags.text, 'text'), ref: flags.ref ?? null, at: flags.at ?? null, name: need(flags.grant, 'grant'), actor: by });
  return { data: { mark: m }, text: `Mark ${m.id} at ${m.at}: ${m.text} (grant ${m.grant_name})` };
}

// `hq mark grant ID NAME`: names a grant mark recorded before names.
async function runMarkGrant(db: Database, args: string[], flags: Flags): Promise<Out> {
  const by = await actor(db, flags),
    m = updateMarkGrantName(db, { id: intFlag(need(args[0], 'mark id'), 'id') ?? 0, name: need(args[1], 'grant name'), actor: by });
  return { data: { mark: m }, text: `Mark ${m.id} is grant ${m.grant_name}: ${m.text}` };
}

// `hq grant act` from a session acting under a standing grant; `hq grant void` takes one back; `hq grant actions` for the weekly report.
async function runGrantCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  if (verb === 'act') {
    const by = await actor(db, flags),
      recorded = recordGrantAction(db, { grant: need(args[0], 'grant name'), target: need(flags.target, 'target'), note: flags.note ?? null, actor: by });
    return { data: { action: recorded }, text: `Recorded ${recorded.id} under ${recorded.grant_name}: ${recorded.target}` };
  }
  if (verb === 'void') {
    const voided = await voidGrantAction({ db, args: parseGrantVoidArgs(args, flags.reason), probe: readOwnerProbeDeps(), clock: readWallClock });
    return { data: { action: voided }, text: `Voided ${voided.id} under ${voided.grant_name}: ${voided.target} (${voided.void_reason})` };
  }
  if (verb !== 'actions' && verb !== undefined) {
    throw new HqError('bad_args', `unknown command: hq grant ${verb}`);
  }
  const at = now(),
    window = { from: sinceArg(flags.since, at), to: iso(at) },
    windowTallies = loadGrantTallies(db, window);
  return { data: { window, grants: windowTallies }, text: windowTallies.length > 0 ? windowTallies.map((t) => formatGrantLine(t)).join('\n') : 'No named grants (name one with hq mark grant ID NAME).' };
}

// The watcher's weekly line: Monday from 08:00 Sydney, once.
async function weeklyStats(db: Database, actor: string, run: Runner = realRunner): Promise<boolean> {
  const t = now();
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  if (get('weekday') !== 'Mon' || Number(get('hour')) < 8) return false;
  const key = `${get('year')}-${get('month')}-${get('day')}`;
  if (getMeta(db, 'stats_weekly_last') === key) return false;
  const from = iso(new Date(t.getTime() - 7 * 86_400_000));
  const gh = await ghMerges(db, from, run);
  // Check and file in one write transaction, so two watchers can't both file it.
  return db
    .transaction(() => {
      if (getMeta(db, 'stats_weekly_last') === key) return false;
      const s = computeStats(db, { from, to: iso(t), gh });
      addNews(db, { from: actor, topic: 'other', text: headline(s), issue: null, link: null, needsGeoff: false });
      setMeta(db, 'stats_weekly_last', key);
      return true;
    })
    .immediate();
}

async function installTimer(unit: string, u: { service: string; timer: string }): Promise<void> {
  const dir = `${process.env['HOME']}/.config/systemd/user`;
  await Bun.write(`${dir}/${unit}.service`, u.service);
  await Bun.write(`${dir}/${unit}.timer`, u.timer);
  for (const cmd of [['daemon-reload'], ['enable', '--now', `${unit}.timer`]]) {
    const r = await realRunner(['systemctl', '--user', ...cmd], { env: cleanEnv() });
    if (r.code !== 0) throw new HqError('timer_failed', `systemctl --user ${cmd.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  }
}

const rcDeps = (): RcDeps => ({ state: (id) => rcState(id), run: realRunner, self: selfCommand() });

async function fleetCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  switch (verb) {
    case 'ensure': {
      // Before atc: a stuck watcher is told even when atc is the thing that's down (GEO-1015).
      const watcher = flags['dry-run'] ? null : watcherAlert(db, await actor(db, flags));
      if (!flags['dry-run']) {
        await sendStaleWatcherAlerts(db);
      }
      const c = await AtcClient.open();
      try {
        const client = makeFleetClient(c);
        const hurry = flags.now === undefined ? undefined : flags.now.split(',').map((x) => x.trim()).filter(Boolean);
        if (hurry && !hurry.length) throw new HqError('bad_args', '--now takes session names, such as --now z-steward,z-qa');
        let steps: Awaited<ReturnType<typeof ensureFleet>>;
        try {
          steps = await ensureFleet(db, client, toExactOptional({ dryRun: Boolean(flags['dry-run']), actor: await actor(db, flags), now: hurry, rc: rcDeps() }));
        } catch (e) {
          // Another run holds the lease: it is doing this run's work, so this one is a skip, not a
          // failure (the hq-fleet timer unit must not go red over it). A --now says so plainly.
          if (e instanceof HqError && e.code === 'busy' && !hurry) return { data: { skipped: e.message, watcher }, text: `Skipped: ${e.message}` };
          throw e;
        }
        const w = watcher === 'alerted' ? `\nhq watcher: stale; told ${owner()}` : watcher === 'recovered' ? `\nhq watcher: ticking again; told ${owner()}` : '';
        return { data: { dryRun: !!flags['dry-run'], steps, watcher }, text: steps.map((x) => `${x.name}: ${x.action} (${x.detail})`).join('\n') + w };
      } finally {
        c.close();
      }
    }
    case 'rc': {
      // The helper `ensure` starts after a spawn; also fine to run by hand.
      const name = need(args[0], 'name');
      // The helper waits up to 30 min, through an atc restart: a lost connection is opened again at
      // the next call. The call that failed is never retried, since a timed-out submit may have typed.
      let c: AtcClient | null = await AtcClient.open();
      const live = async <T,>(f: (x: FleetClient) => Promise<T>): Promise<T> => {
        c ??= await AtcClient.open();
        try {
          return await f(makeFleetClient(c));
        } catch (e) {
          if (e instanceof HqError && e.code === 'atc_unreachable') {
            c.close();
            c = null;
          }
          throw e;
        }
      };
      const client: FleetClient = {
        sessions: () => live((x) => x.sessions()),
        spawn: (p) => live((x) => x.spawn(p)),
        pin: (id) => live((x) => x.pin(id)),
        submit: (id, text) => live((x) => x.submit!(id, text)),
      };
      try {
        const step = await rcWatch(db, client, rcDeps(), name, await actor(db, flags));
        return { data: { name, step }, text: step ? `${step.name} ${step.action}: ${step.detail}` : `${name}: no Remote Control step pending; nothing typed` };
      } finally {
        c?.close();
      }
    }
    case 'remove':
    case 'restore': {
      const name = need(args[0], 'name');
      const r = retireName(db, name, await actor(db, flags), verb === 'remove');
      const text =
        verb === 'remove'
          ? `${name} ${r.changed ? 'is retired' : 'was already retired'}: ensure never spawns it.${r.wakeRemoved ? ` Removed ${r.wakeRemoved} wake-list entr${r.wakeRemoved === 1 ? 'y' : 'ies'}.` : ''} hq stopped nothing; stop its session yourself.`
          : `${name} ${r.changed ? 'is declared again' : 'was not retired'}: ensure spawns it after 10 min without a live session.`;
      return { data: { name, ...r, retired: retiredNames(db) }, text };
    }
    case 'status':
    case undefined: {
      const last = loadFleetLast(db);
      const timer = (await realRunner(['systemctl', '--user', 'is-active', `${FLEET_UNIT}.timer`], { env: cleanEnv() })).stdout.trim() || 'inactive';
      const declared = declaredFleet(db);
      // Read-only: atc down means no check, not a failed status. --json skips it unless --prompts
      // asks: the compaction hook reads `hq fleet --json` under a 5 s limit.
      let drift: Record<string, PromptDrift> = {},
        plugins: Record<string, PluginDrift> = {};
      let c: AtcClient | null = null;
      if (!flags.json || flags.prompts) try {
        c = await AtcClient.open();
        const getter = c;
        const sessions = (await c.call('session.list', {}, sessionListRequiredSchema)).sessions;
        plugins = findPluginDrift(declared, sessions, fleetIds(db));
        drift = await promptDrift({ prompt: async (id) => (await getter.call('session.get', { session: id }, sessionGetSchema)).prompt ?? undefined }, declared, sessions, fleetIds(db));
      } catch {
        drift = {};
      } finally {
        c?.close();
      }
      const lines = [
        `timer: ${timer}`,
        `declared: ${declared.map((e) => e.name).join(', ')}${retiredNames(db).length ? `; retired: ${retiredNames(db).join(', ')}` : ''}`,
        last ? `last ensure: ${last.at}${last.dryRun ? ' (dry run)' : ''}` : 'last ensure: never',
        ...(last?.steps ?? []).map((x) => `  ${x.name}: ${x.action} (${x.detail})`),
        ...formatDriftLines(drift, plugins),
      ];

      // `prompt` stays the source string; the check sits beside it as `promptCheck`, and a plugin
      // folder mismatch as `pluginCheck`.
      return { data: { timer, declared: declared.map((e) => buildFleetChecks(e, drift[e.name], plugins[e.name])), retired: retiredNames(db), roles: rolesByName(retiredNames(db)), forwards: forwards(db), last }, text: lines.join('\n') };
    }
    case 'timer': {
      if (args[0] === 'install') {
        await installTimer(FLEET_UNIT, fleetTimerUnits(selfCommand().join(' '), process.env));
        return { data: { unit: `${FLEET_UNIT}.timer` }, text: `Fleet check every 5 min (${FLEET_UNIT}.timer).` };
      }
      if (args[0] === 'remove') {
        await removeTimer(realRunner, { directory: `${process.env['HOME']}/.config/systemd/user`, unit: FLEET_UNIT, env: cleanEnv() });
        return { data: { removed: true }, text: 'Fleet timer off.' };
      }
      throw new HqError('bad_args', 'hq fleet timer install|remove');
    }
    default:
      throw new HqError('bad_args', `unknown command: hq fleet ${verb}`);
  }
}

async function probeCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  switch (verb) {
    case 'run': {
      const r = await probeOnce(db, realFetcher, await actor(db, flags));
      const extra = `${r.opened !== undefined ? `; outage ${r.opened} opened` : ''}${r.closed !== undefined ? `; outage ${r.closed} closed` : ''}${r.unreadyOpened !== undefined ? `; unready ${r.unreadyOpened} opened` : ''}${r.unreadyClosed !== undefined ? `; unready ${r.unreadyClosed} closed` : ''}`;
      return { data: { ...r }, text: `${r.state} (${r.ms} ms)${extra}` };
    }
    case 'status':
    case undefined: {
      const days = intFlag(flags.days, 'days') ?? 7;
      if (days < 1 || days > 60) throw new HqError('bad_args', '--days must be 1 to 60');
      const to = now();
      const from = new Date(to.getTime() - days * 86_400_000);
      const timer = (await realRunner(['systemctl', '--user', 'is-active', `${PROBE_UNIT}.timer`], { env: cleanEnv() })).stdout.trim() || 'inactive';
      const last = lastSample(db);
      const open = openOutage(db);
      const d = downtime(db, from, to);
      const outages = outagesIn(db, from, to);
      const unready = unreadyIn(db, from, to);
      const openUnreadyRow = openUnready(db);
      const lastReadyRow = lastReady(db);
      const lines = [
        `timer: ${timer}`,
        last ? `last sample: ${last.at} (${last.target_ok ? 'up' : last.control_ok ? 'down' : 'blind'}, ${last.ms ?? '?'} ms)` : 'last sample: none',
        open ? `OPEN outage since ${open.started_at} (detected ${open.detected_at})` : 'no open outage',
        lastReadyRow ? `last ready check: ${lastReadyRow.at} (${lastReadyRow.ready_ok ? 'ready' : 'NOT ready'})` : 'last ready check: none',
        openUnreadyRow ? `OPEN unready since ${openUnreadyRow.started_at} (detected ${openUnreadyRow.detected_at})` : 'no open unready episode',
        `last ${days} d: ${d.downMinutes} min down in ${d.outages} outage(s), slowest detection ${d.longestDetectMinutes} min, ${d.blindMinutes} min blind, ${d.samples} samples`,
        ...outages.map((o) => `  #${o.id} ${o.started_at} to ${o.ended_at ?? 'now'} (detected ${o.detected_at})`),
        `last ${days} d: ${unready.length} unready episode(s)`,
        ...unready.map((o) => `  #${o.id} ${o.started_at} to ${o.ended_at ?? 'now'} (detected ${o.detected_at})`),
      ];
      return { data: { timer, last, lastReady: lastReadyRow, open, openUnready: openUnreadyRow, downtime: d, outages, unready }, text: lines.join('\n') };
    }
    case 'timer': {
      if (args[0] === 'install') {
        await installTimer(PROBE_UNIT, buildProbeTimerUnits(selfCommand().join(' '), process.env));
        return { data: { unit: `${PROBE_UNIT}.timer` }, text: `Nix probe every minute (${PROBE_UNIT}.timer).` };
      }
      if (args[0] === 'remove') {
        await removeTimer(realRunner, { directory: `${process.env['HOME']}/.config/systemd/user`, unit: PROBE_UNIT, env: cleanEnv() });
        return { data: { removed: true }, text: 'Probe timer off.' };
      }
      throw new HqError('bad_args', 'hq probe timer install|remove');
    }
    default:
      throw new HqError('bad_args', `unknown command: hq probe ${verb}`);
  }
}

async function backupCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  const run: Runner = (cmd, opts) => realRunner(cmd, { ...opts, env: opts?.env ?? cleanEnv() });
  switch (verb) {
    case 'run': {
      const r = await runBackup(db, run, await actor(db, flags));
      if (!r.ok) throw new HqError('backup_failed', `backup failed after ${r.seconds}s: ${r.error}`);
      return { data: { backup: r }, text: `Snapshot ${r.snapshot} in ${r.seconds}s; remote: ${r.remote}.` };
    }
    case 'status':
    case undefined: {
      const { last, lastOk, test } = lastBackup(db);
      let remote: string;
      try {
        remote = readRemoteEnv() ? 'configured' : `not configured (${backupPaths().remoteEnv})`;
      } catch (e) {
        remote = `misconfigured: ${(e as Error).message}`;
      }
      const timer = (await realRunner(['systemctl', '--user', 'is-active', `${BACKUP_UNIT}.timer`], { env: cleanEnv() })).stdout.trim() || 'inactive';
      let snaps: { short_id: string; time: string }[] = [];
      try {
        snaps = await snapshots(run, false);
      } catch {}
      const lines = [
        `timer: ${timer}; keep ${KEEP.hourly} hourly + ${KEEP.daily} daily`,
        `last run: ${last ? `${last.at} ${last.ok ? 'ok' : `FAILED: ${last.error}`} (snapshot ${last.snapshot ?? '-'}, remote ${last.remote}, ${last.seconds}s)` : 'never'}`,
        `last good: ${lastOk ?? 'never'}`,
        `remote: ${remote}`,
        `local snapshots: ${snaps.length}${snaps.length ? `, newest ${snaps.at(-1)!.short_id} at ${snaps.at(-1)!.time}` : ''}`,
        `restore test: ${test ? `${test['at']} ${test['ok'] ? 'ok' : `FAILED: ${test['error']}`} (${test['files']} files, hq.db ${test['dbCheck']})` : 'never'}`,
      ];
      return { data: { timer, last, lastOk, remote, snapshots: snaps.length, test }, text: lines.join('\n') };
    }
    case 'restore': {
      const r = await restore(run, need(flags.to, 'to'), { snapshot: flags.snapshot ?? 'latest', remote: !!flags.remote });
      return { data: { ...r }, text: `Restored into ${r.to}.${r.db ? ` hq.db is at ${r.db}.` : ''} Nothing live was touched.` };
    }
    case 'test': {
      const r = await restoreTest(db, run, { remote: !!flags.remote, scratch: backupPaths().state }, await actor(db, flags));
      if (!r.ok) throw new HqError('restore_test_failed', `restore test failed: ${r.error ?? r.dbCheck}`);
      return { data: { ...r }, text: `Restore test passed: ${r.files} files, hq.db ${r.dbCheck}.` };
    }
    case 'timer': {
      const dir = `${process.env['HOME']}/.config/systemd/user`;
      if (args[0] === 'install') {
        const p = ensurePassword();
        const units = timerUnits(selfCommand().join(' '), process.env);
        await Bun.write(`${dir}/${BACKUP_UNIT}.service`, units.service);
        await Bun.write(`${dir}/${BACKUP_UNIT}.timer`, units.timer);
        for (const cmd of [['daemon-reload'], ['enable', '--now', `${BACKUP_UNIT}.timer`]]) {
          const r = await realRunner(['systemctl', '--user', ...cmd], { env: cleanEnv() });
          if (r.code !== 0) throw new HqError('timer_failed', `systemctl --user ${cmd.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
        }
        return { data: { unit: `${BACKUP_UNIT}.timer`, passwordCreated: p.created }, text: `Hourly timer on (${BACKUP_UNIT}.timer).${p.created ? ` A new restic password is at ${p.path}: store it off this PC.` : ''}` };
      }
      if (args[0] === 'remove') {
        await removeTimer(realRunner, { directory: dir, unit: BACKUP_UNIT, env: cleanEnv() });
        return { data: { removed: true }, text: 'Hourly timer off. The snapshots stay.' };
      }
      throw new HqError('bad_args', 'hq backup timer install|remove');
    }
    default:
      throw new HqError('bad_args', `unknown command: hq backup ${verb}`);
  }
}

async function newsCommand(db: Database, verb: string | undefined, flags: Flags): Promise<Out> {
  switch (verb) {
    case 'add': {
      const n = addNews(db, {
        from: flags.from ?? (await actor(db, flags)),
        topic: need(flags.topic, 'topic'),
        text: need(flags.text, 'text'),
        issue: flags.issue ?? null,
        link: flags.link ?? null,
        needsGeoff: !!flags['needs-geoff'],
        tag: flags.tag ?? null,
      });
      return { data: { news: n }, text: `News ${n.id} filed under ${n.topic}${n.tag ? ` (tag ${n.tag})` : ''}${n.needs_geoff ? `; ${owner()} is told now` : ''}.` };
    }
    case 'read': {
      const n = readNews(db, intFlag(need(flags.upto, 'upto'), 'upto')!, await actor(db, flags));
      return { data: { read: n }, text: n ? `Marked ${n} item(s) read.` : 'Nothing unread up to there.' };
    }
    case undefined:
    case 'list': {
      const all = !!flags.all;
      const items = listNews(db, { all, limit: intFlag(flags.limit, 'limit') ?? 200 });
      const more = all ? 0 : unreadCount(db) - items.length;
      return { data: { news: items, moreUnread: more }, text: digest(items, { all, more }) };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq news ${verb}`);
  }
}

async function lanesCommand(context: Pick<Ctx, 'db' | 'verb' | 'rest' | 'flags' | 'run'>): Promise<Out> {
  const db = context.db;
  const verb = context.verb;
  const flags = context.flags;
  const by = () => actor(db, flags);
  switch (verb) {
    case 'tick': {
      const r = tick(db, await readCapacity(realRunner), await by());
      return { data: { ...r }, text: `${r.slots} slot(s) free${r.freeMib === null ? '' : ` (${r.freeMib} MiB)`}; ${r.nudged ? `nudged ${orchestratorName()}` : r.why}` };
    }
    case 'watch': {
      const interval = (intFlag(flags.interval, 'interval') ?? 300) * 1000;
      const me = await by();
      try {
        if (markVersion(db, VERSION, me)) console.log(`${iso(now())} marked hq ${VERSION}`);
      } catch (e) {
        console.log(`${iso(now())} version mark failed: ${String((e as Error).message ?? e)}`);
      }
      return watchLoop(db, { me, run: boundedRunner(realRunner, CALL_MS), log: (l) => console.log(l), steps: { runs: () => watchRuns(db, me), weekly: () => weeklyStats(db, me, boundedRunner(realRunner, CALL_MS)), health: () => healthTick(db, me), capacity: () => capacityTick(db, me), refusals: async () => (await scanRefusals(db)).refusals_added } }, interval);
    }
    case 'start': {
      const r = await installLanes(realRunner, { home: getHome(), exec: selfCommand(), interval: intFlag(flags.interval, 'interval'), processEnv: process.env, env: cleanEnv() });
      return {
        data: { unit: LANES_UNIT, path: r.path, interval: r.interval, replacedTransient: r.replacedTransient },
        text: `Lanes watcher on duty as ${LANES_UNIT}, every ${r.interval}s; it restarts after a crash and starts at login.${r.replacedTransient ? ' Replaced the old transient unit.' : ''} Logs: journalctl --user -u ${LANES_UNIT}`,
      };
    }
    case 'stop': {
      await stopLanes(realRunner, cleanEnv());
      return { data: { unit: LANES_UNIT, stopped: true }, text: 'Lanes watcher stood down; it stays off after a reboot until hq lanes start.' };
    }
    case 'hold': {
      const h = holdLanes(db, intFlag(need(flags.minutes, 'minutes'), 'minutes')!, need(flags.reason, 'reason'), await by());
      return { data: { hold: h }, text: `Slot nudges held until ${h.until}: ${h.reason}. They resume by themselves; hq lanes release ends it sooner.` };
    }
    case 'release': {
      const had = releaseLanes(db, await by());
      return { data: { released: had }, text: had ? 'Slot nudges resume from the next look.' : 'No lanes hold to release.' };
    }
    case 'cap': {
      const args = parseLanesCapArgs(context.rest, flags.until, flags.reason);
      return runLanesCapCommand({ db, at: readCapClock(args), args, probe: readOwnerProbeDeps() });
    }
    case 'skip': {
      const args = parseLaneSkipArgs(context.rest, flags.until, flags.reason);
      return runLaneSkipCommand({ db, actor: await by(), at: now(), args });
    }
    case 'promotable': {
      const backlog = await readPromotableIssues(makeAuditedLinearCaller(db, context.run), rulesTable.team);
      const issues = backlog.map((issue) => ({ identifier: issue.identifier, title: issue.title }));
      return { data: { issues }, text: issues.length > 0 ? issues.map((issue) => `${issue.identifier}  ${issue.title}`).join('\n') : 'No Backlog issue is ready to promote.' };
    }
    case 'ready': {
      if (flags.lane) {
        const counts = parseReady(await readLanes(), flags.lane);
        const total = flags['ready-total'] === undefined ? null : parseReadyTotal(flags['ready-total']);
        const skipped = flags.skipped === undefined ? null : parseSkipped(flags.skipped);
        reportLaneReady(db, counts, await by(), { total, skipped });
        const sum = readySummary(db, LANES.readyFreshMinutes());
        return { data: { ready: counts, total, skipped }, text: `Noted Ready by lane: ${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(', ')}.${sum ? `\n${sum.line}` : ''}` };
      }
      if (flags['ready-total'] !== undefined || flags.skipped !== undefined) throw new HqError('bad_args', '--ready-total and --skipped go with --lane name=n,...');
      const n = intFlag(need(flags.count, 'count (or --lane name=n,...)'), 'count')!;
      reportReady(db, n, await by());
      return { data: { count: n }, text: `Noted: ${n} eligible Ready issue(s) in total; per lane, use --lane name=n,...` };
    }
    case 'status':
    case 'log':
    case undefined: {
      const unit = await realRunner(['systemctl', '--user', 'is-active', LANES_UNIT], { env: cleanEnv() });
      const enabled = (await realRunner(['systemctl', '--user', 'is-enabled', LANES_UNIT], { env: cleanEnv() })).stdout.trim() || 'not installed';
      const last = db.query('SELECT * FROM lanes_samples ORDER BY seq DESC LIMIT 1').get();
      const nudges = nudgeLog(db, intFlag(flags.limit, 'limit') ?? 20);
      const gap24 = idleSlotMinutes(db, 24);
      const ready = eligibleNow(db);
      const hold = getLanesHold(db);
      const sample = await readCapacity(realRunner);
      const slotPlan = readSlotPlan(db, sample);
      const lookAt = now();
      const slotCause = readSlotCause(db, slotPlan, lookAt);
      const slotMinutesToday = readSlotMinutes(db, sydney(lookAt).date);
      const readyNote = readySummary(db, LANES.readyFreshMinutes());
      const parked = parkedRuns(db);
      const capView = slotPlan?.cap ?? readFallbackCapView(db, sample, lookAt);
      const fallbackCapLine = slotPlan ? null : formatCapLine(capView);
      const laneLines = slotPlan
        ? [
            `imp room now: ${slotsFrom(sample.cap!, sample.impMib).slots} slot(s) (${sample.cap!.imp?.freeMib ?? '?'} MiB free; 0 when no unattended imp provider has quota)`,
            formatLineRoom(loadImpRoom(db, { budgetSlots: slotsFrom(sample.cap ?? {}, sample.impMib).slots, impMib: sample.impMib })),
            ...formatSlotPlan(slotPlan),
            ...formatSlotCause(slotCause, slotMinutesToday, slotPlan.pool.capHeld),
            ...(readyNote ? [`  ${readyNote.line}`, ...skippedLines(readyNote).map((l) => `  ${l}`)] : []),
            ...(parked.length > 0 ? [`  parked, not counted (blocked with no session awake, or working with every session gone): ${parked.map((parkedRun) => parkedRun.issue).join(', ')}`] : []),
          ]
        : [`lanes: no slot plan (${sample.error ?? `no lanes in ${pacingPath()}`})`, ...(fallbackCapLine === null ? [] : [fallbackCapLine])];
      const lines = [
        `watcher: ${unit.stdout.trim() || 'inactive'} (${enabled})`,
        ...laneLines,
        ...(sample.slots ? [formatLanePlan(buildLanePlan(sample.slots.imp, sample.impMib, capacitySettings(db)))] : []),
        ...(hold ? [`hold: nudges paused until ${hold.until} (${hold.by}: ${hold.reason})`] : []),
        `last sample: ${last ? JSON.stringify(last) : 'none'}`,
        `ready count: ${ready.count ?? 'unknown'}${ready.at ? ` (reported ${ready.at})` : ''}`,
        `idle slot-minutes, last 24h: ${gap24.slotMinutes} over ${gap24.samples} samples`,
        nudges.length ? 'nudges (newest first):' : 'nudges: none yet',
        ...nudges.map((n) => `  ${n.at} ${n.slots} free for ${n.free_minutes} min, eligible ${n.eligible ?? '?'} → after: ${n.slots_after ?? 'pending'}`),
      ];
      const slotCauses = { now: { cause: slotCause.cause, slots: slotCause.slots, since: slotCause.since, readyAgeMinutes: slotCause.readyAgeMinutes, reason: slotCause.reason, backlogError: slotCause.backlogError }, today: slotMinutesToday };
      return { data: { watcher: unit.stdout.trim() || 'inactive', enabled, hold, plan: slotPlan, cap: capView, slotCauses, last, ready, idle24h: gap24, nudges }, text: lines.join('\n') };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq lanes ${verb}`);
  }
}

async function wakeCommand(db: Database, verb: string | undefined, args: string[], flags: Flags): Promise<Out> {
  const by = () => actor(db, flags);
  const resolveSession = async (target: string) => {
    const c = await AtcClient.open();
    try {
      return await c.resolve(target, fleetIds(db));
    } finally {
      c.close();
    }
  };
  switch (verb) {
    case undefined: {
      const r = await runWake(db, { dryRun: !!flags['dry-run'], waitMs: (intFlag(flags.wait, 'wait') ?? 0) * 1000, actor: await by() });
      const lines = [
        `${r.dryRun ? 'Would wake' : 'Woke'} after restart ${r.runID}:`,
        ...r.sent.map((s) => `  ${s.error ? '✕' : '✓'} ${s.name} (${s.reason})${s.error ? `: ${s.error}` : ''}`),
        ...r.skipped.map((s) => `  - ${s.name}: ${s.why}`),
      ];
      return { data: { ...r }, text: lines.join('\n') };
    }
    case 'list': {
      const rows = wakeList(db);
      return { data: { sessions: rows }, text: rows.length ? rows.map((r) => `${r.session_id} ${r.name}${r.note ? ` · ${r.note}` : ''}`).join('\n') : 'Wake list empty.' };
    }
    case 'add': {
      const s = await resolveSession(need(args[0], 'session (id or live name)'));
      const r = wakeAdd(db, s, flags.note ?? null, await by());
      return { data: r, text: `${r.result}: ${s.name} (${s.id})` };
    }
    case 'remove': {
      const e = wakeRemove(db, need(args[0], 'session (id or name)'), await by());
      return { data: { removed: e }, text: `removed: ${e.name} (${e.session_id})` };
    }
    case 'import': {
      const file = need(args[0], 'file (wake-sessions.txt format)');
      const actorName = await by();
      const results = parseWakeFile(await Bun.file(file).text()).map((s) => ({ ...wakeAdd(db, s, null, actorName) }));
      return { data: { results }, text: results.map((r) => `${r.result}: ${r.entry.name}`).join('\n') };
    }
    default:
      throw new HqError('bad_args', `unknown command: hq wake ${verb}`);
  }
}

function status(db: Database): Out {
  const open = openItem(db);
  const next = nextEligible(db);
  const reasons = waitReasons(db);
  const counts = db.query('SELECT kind, state, COUNT(*) AS n FROM asks GROUP BY kind, state').all() as { kind: Kind; state: AskState; n: number }[];
  const byKind: Record<string, Record<string, number>> = { call: {}, proposal: {} };
  for (const c of counts) byKind[c.kind]![c.state] = c.n;
  const later = db.query(`SELECT id, kind, due_at FROM asks WHERE state='later' ORDER BY due_at, id`).all() as { id: string; kind: Kind; due_at: string }[];
  const nextLater = later[0] ?? null;
  const openUnblocks = listUnblocks(db, 'open');
  const unblockOpen = openUnblocks.filter((item) => item.kind !== 'watch').length;
  const unblockWatching = openUnblocks.length - unblockOpen;
  const unblockNew = newSincePush(db).length;
  const outbox = db.query(`SELECT status, COUNT(*) AS n FROM outbox WHERE status != 'sent' GROUP BY status`).all() as { status: string; n: number }[];
  const ob = Object.fromEntries(outbox.map((o) => [o.status, o.n]));
  const hold = currentHold(db);

  const waits = next ? reasons : [];
  const lines = [
    open ? `OPEN: ${askLine(open)} (since ${open.opened_at})` : 'OPEN: none',
    next ? `NEXT: ${askLine(next)}${waits.length ? `\n  waits: ${waits.join('; ')}` : '\n  ready to open'}` : 'NEXT: none',
    `calls: ${fmtCounts(byKind['call'] ?? {})} · proposals: ${fmtCounts(byKind['proposal'] ?? {})}`,
    later.length ? `later:\n${later.map((l) => `  ${l.kind} ${l.id} due ${l.due_at}`).join('\n')}` : null,
    `unblock: ${unblockOpen} open, ${unblockNew} new since push${unblockWatching > 0 ? `, ${unblockWatching} watching` : ''}`,
    hold ? `HOLD: ${hold.reason} (since ${hold.since}, by ${hold.by})` : null,
    ob['pending'] || ob['failed'] ? `outbox: ${ob['pending'] ?? 0} pending, ${ob['failed'] ?? 0} failed (hq outbox flush --retry)` : null,
  ].filter(Boolean);
  return {
    data: {
      now: iso(now()),
      open,
      next,
      waits,
      counts: byKind,
      nextLater,
      later,
      unblock: { open: unblockOpen, newSincePush: unblockNew, watching: unblockWatching },
      hold,
      outbox: { pending: ob['pending'] ?? 0, failed: ob['failed'] ?? 0 },
    },
    text: lines.join('\n'),
  };
}

function fmtCounts(c: Record<string, number>): string {
  const parts = Object.entries(c).map(([s, n]) => `${n} ${s}`);
  return parts.length ? parts.join(', ') : 'none';
}

// The inline commands, one function each, so the registry can hand every row a handler.
async function restartCommand(db: Database, flags: Flags): Promise<Out> {
  if (flags.here) {
    const r = await restartHere(db, realRunner, await actor(db, flags), !!flags.force);
    return { data: { ...r }, text: `restart exit ${r.restartCode}; log: ${r.log}` };
  }
  const r = await launchDetached(realRunner, { force: !!flags.force });
  return { data: r, text: `Restart launched as ${r.unit}. It outlives this session. Log: ${r.log}` };
}

async function refusalsCommand(db: Database, verb: string | undefined, flags: Flags): Promise<Out> {
  if (verb === 'scan') {
    const mb = flags['budget-mb'] === undefined ? undefined : intFlag(flags['budget-mb'], 'budget-mb');
    if (mb !== undefined && (mb === null || mb < 1)) throw new HqError('bad_args', '--budget-mb must be a whole number of at least 1');
    const r = await scanRefusals(db, { windowDays: parseDays(flags.since, 'since', 14), ...(mb ? { budgetBytes: mb * 1024 * 1024 } : {}) });
    return { data: { ...r }, text: `Read ${r.files_read} file(s), ${r.bytes_read} bytes; added ${r.refusals_added} refusal(s); ${r.files_left} file(s) left for the next scan.` };
  }
  const days = parseDays(flags.days, 'days', 7);
  if (days > 365) throw new HqError('bad_args', '--days must be 1 to 365');
  const rows = refusalRows(db, new Date(now().getTime() - days * 86_400_000), new Date(now().getTime() + 60_000));
  if (flags.by !== undefined) {
    if (!(BY as readonly string[]).includes(flags.by)) throw new HqError('bad_args', `--by must be one of ${BY.join(', ')}`);
    const t = tally(rows, flags.by as By);
    return { data: { tally: t }, text: t.length ? t.map((x) => `${String(x.count).padStart(4)}  ${x.key}`).join('\n') : `No refusals in the last ${days} day(s).` };
  }
  return { data: { items: rows }, text: rows.length ? rows.map(refusalLine).join('\n') : `No refusals in the last ${days} day(s).` };
}

async function refsCommand(verb: string | undefined, flags: Flags): Promise<Out> {
  if (verb !== undefined) {
    throw new HqError('bad_args', 'hq refs [--days 7]');
  }
  const days = parseDays(flags.days, 'days', 7);
  if (days > 365) {
    throw new HqError('bad_args', '--days must be 1 to 365');
  }
  const items = await readReferenceCounts({ days });
  return { data: { days, items }, text: formatReferenceLines(items, days) };
}

async function repairCommand(verb: string | undefined, rest: string[], flags: Flags): Promise<Out> {
  if (verb !== 'advisor-400') throw new HqError('bad_args', 'hq repair advisor-400 <session> [--file T.jsonl] [--apply]');
  return await repairAdvisor400(rest[0], toExactOptional({ file: flags.file as string | undefined, apply: Boolean(flags.apply) }));
}

async function pinsCommand(): Promise<Out> {
  const c = await AtcClient.open();
  try {
    const pins = await listPins(c);
    const text = pins.length
      ? pins.map((p) => `${fmtIdle(p.idleMs).padStart(7)}  ${p.state.padEnd(9)}  ${p.id.slice(0, 8)}  ${p.name}`).join('\n')
      : 'No pinned sessions.';
    return { data: { pins }, text: `   idle  state      id        name\n${text}` };
  } finally {
    c.close();
  }
}

async function openCommand(db: Database, verb: string | undefined, flags: Flags): Promise<Out> {
  const a = openAsk(db, toExactOptional({ id: verb, force: Boolean(flags.force), actor: await actor(db, flags) }));
  return { data: { [a.kind]: a, item: a }, text: `Opened. The owner has the floor.\n\n${askFull(a)}` };
}

async function holdCommand(db: Database, flags: Flags): Promise<Out> {
  const by = await actor(db, flags);
  const reason = need(flags.reason, 'reason');
  db.transaction(() => {
    setMeta(db, 'hold', JSON.stringify({ reason, since: iso(now()), by }));
    logEvent(db, 'hq', 'queue', 'held', by, null, null, { reason });
  }).immediate();
  return { data: { hold: currentHold(db) }, text: `Queue held: ${reason}` };
}

async function releaseCommand(db: Database, flags: Flags): Promise<Out> {
  const by = await actor(db, flags);
  const released = db.transaction(() => {
    if (!currentHold(db)) return false;
    setMeta(db, 'hold', null);
    setMeta(db, 'hold_released_at', now().toISOString());
    logEvent(db, 'hq', 'queue', 'released', by, null, null);
    return true;
  }).immediate();
  return { data: { hold: null, released }, text: released ? 'Queue released.' : 'No hold to release.' };
}

async function outboxCommand(db: Database, verb: string | undefined, rest: string[], flags: Flags): Promise<Out> {
  if (verb === 'flush') return { data: {}, text: 'Flushed.' };
  if (verb === 'drop') {
    const id = intFlag(need(rest[0], 'item id'), 'id')!;
    const ok = dropOutboxItem(db, id);
    if (ok) logEvent(db, 'hq', `outbox:${id}`, 'dropped', await actor(db, flags), null, null, {});
    return { data: { dropped: ok }, text: ok ? `Dropped outbox item ${id}.` : `No unsent item ${id}.` };
  }
  if (verb === 'forward') {
    const from = need(rest[0], 'from session');
    const to = flags.remove ? null : need(rest[1], 'to session');
    const r = setForward(db, from, to);
    logEvent(db, 'hq', `forward:${from}`, to ? 'forward-set' : 'forward-cleared', await actor(db, flags), null, null, { to, ...r });
    return { data: { from, to, ...r, forwards: forwards(db) }, text: to ? `Messages for ${from} now go to ${to}. Moved ${r.moved} queued, merged ${r.merged} duplicate(s).` : `No more forwarding for ${from}.` };
  }
  if (verb === 'forwards') {
    const map = forwards(db);
    return { data: { forwards: map }, text: Object.keys(map).length ? Object.entries(map).map(([a, b]) => `${a} → ${b}`).join('\n') : 'No forwards.' };
  }
  const rows = db.query(`SELECT * FROM outbox WHERE status != 'sent' ORDER BY id`).all() as OutboxRow[];
  return { data: { outbox: rows }, text: rows.length ? rows.map((r) => `${r.id} [${r.status}] → ${r.target}: ${r.text}${r.last_error ? `\n   last error: ${r.last_error}` : ''}`).join('\n') : 'Outbox empty.' };
}

// Each command group's entry point, keyed by the `group` a registry row names (src/commands.ts).
const GROUPS: Record<string, (context: Ctx) => Promise<Out>> = {
  status: async (c) => status(c.db),
  open: (c) => openCommand(c.db, c.verb, c.flags),
  hold: (c) => holdCommand(c.db, c.flags),
  release: (c) => releaseCommand(c.db, c.flags),
  pins: () => pinsCommand(),
  band: async (c) => {
    const band = await loadBand(c.db, pacingPath());
    return { data: { band }, text: band.line };
  },
  pane: async (c) => {
    const pane = await loadPane(c.db, pacingPath(), 'http://127.0.0.1:4317/');
    return { data: { pane }, text: pane.markdown };
  },
  whois: (c) => {
    const id = need(c.verb, 'session-id'),
      name = findFleetName(c.db, id);
    return Promise.resolve({ data: { session: id, name }, text: name ?? `${id} is no declared fleet session` });
  },
  console: async (command) => {
    if (command.verb === 'login') {
      return await runConsoleLogin();
    }
    return await runConsole(command.db, intFlag(command.flags.port, 'port'), { isTTY: process.stdout.isTTY === true, openClient: readOwnerProbeDeps().openClient });
  },
  restart: (c) => restartCommand(c.db, c.flags),
  wake: (c) => wakeCommand(c.db, c.verb, c.rest, c.flags),
  review: (c) => runReviewCommand(c),
  // oxlint-disable-next-line id-length -- grandfathered handler parameter shared by every entry of this table
  pr: (c) => runPRCommand({ run: realRunner, db: c.db, verb: c.verb, rest: c.rest, flags: c.flags, actor: () => actor(c.db, c.flags), readOwnerSession: () => readOwnerSession(c.db, readOwnerProbeDeps()), readReviewerSession: () => readRoleSession(c.db, readOwnerProbeDeps(), 'reviewer') }),
  noslop: async (command) => runNoslopCommand({ run: command.run, db: command.db, verb: command.verb, rest: command.rest, since: typeof command.flags.since === 'string' ? command.flags.since : undefined, force: command.flags.force === true, actor: await actor(command.db, command.flags), readOwnerSession: () => readOwnerSession(command.db, readOwnerProbeDeps()) }),
  repair: (c) => repairCommand(c.verb, c.rest, c.flags),
  refs: (context) => refsCommand(context.verb, context.flags),
  refusals: (c) => refusalsCommand(c.db, c.verb, c.flags),
  run: (c) => runCommand(c.db, c.verb, c.rest, c.flags),
  lanes: async (context) => {
    const out = await lanesCommand(context);
    return context.verb === undefined || context.verb === 'status' || context.verb === 'log' ? withStaleBuild(out, checkLanesBuild((path) => readFileSync(path, 'utf8'))) : out;
  },
  focus: async (context) => runFocusCommand({ db: context.db, call: makeAuditedLinearCaller(context.db, context.run), actor: await actor(context.db, context.flags), at: now(), verb: context.verb, rest: context.rest, reserves: context.flags.reserve ?? [] }),
  stats: (c) => statsCommand(c.db, c.flags),
  answers: (c) => Promise.resolve(runAnswersCommand(c.db, c.flags)),
  grant: (c) => runGrantCommand(c.db, c.verb, c.rest, c.flags),
  kinds: (c) => kindsCommand(c.db, c.verb, c.flags),
  linear: (context) => runLinearCommand({ call: makeAuditedLinearCaller(context.db, context.run), files: { statSync, readdirSync, writeFileSync, rmSync } }, context.flags),
  goals: (c) => goalsCommand(c.db, c.verb, c.rest, c.flags),
  defs: (c) => defsCommand(c.db, c.verb, c.rest, c.flags),
  repo: async (c) => {
    const who = await actor(c.db, c.flags);
    return runRepoCommand({
      actor: who,
      createBackup: createStoreBackup,
      db: c.db,
      dryRun: c.flags['dry-run'] === true,
      openStore: (file, options) => new Database(file, options),
      rest: c.rest,
      run: c.run,
      verb: c.verb,
    });
  },
  morning: (c) => morningCommand(c.db, c.verb, c.flags),
  followup: (c) => followupCommand(c.db, c.verb, c.rest, c.flags),
  typed: (c) => typedCommand(c.db, c.verb, c.flags),
  mark: (c) => markCommand(c.db, c.verb, c.rest, c.flags),
  fleet: async (c) => {
    const out = await fleetCommand(c.db, c.verb, c.rest, c.flags);
    return withStaleBuild(out, checkFleetBuild());
  },
  probe: (c) => probeCommand(c.db, c.verb, c.rest, c.flags),
  backup: (c) => backupCommand(c.db, c.verb, c.rest, c.flags),
  capacity: (c) => capacityCommand(c.db, c.verb, c.rest, c.flags),
  units: (context) => runUnitsCommand({ verb: context.verb, run: context.run, home: getHome(), env: cleanEnv() }),
  health: (c) => healthCommand(c.db, c.verb, c.rest, c.flags),
  news: (c) => newsCommand(c.db, c.verb, c.flags),
  outbox: (c) => outboxCommand(c.db, c.verb, c.rest, c.flags),
  ask: (c) => askCommand(c.db, c.noun as Kind, need(c.verb, 'command'), c.rest, c.flags),
  unblock: (c) => unblockCommand(c.db, need(c.verb, 'command'), c.rest, c.flags),
  capabilities: async (c) => capabilities(VERSION, SCHEMA_VERSION, c.flags.require),
  version: () => Promise.resolve(renderVersion(VERSION, SCHEMA_VERSION, readBuild())),
};
registerGroups(GROUPS);

async function runArgv(argv: string[], runner: Runner): Promise<{ out: Out; db: Database | null }> {
  const { values: flags, positionals } = parse(argv);
  const [noun, verb, ...rest] = positionals;
  if (flags.version) {
    return runArgv(['version'], runner);
  }
  if (flags.help || !noun || noun === 'help') return { out: { data: { help: HELP }, text: HELP }, db: null };
  if (noun === 'version') {
    return { out: renderVersion(VERSION, SCHEMA_VERSION, readBuild()), db: null };
  }
  // Like help and version, capabilities never opens the db: a session runs it before anything else.
  if (noun === 'capabilities') return { out: capabilities(VERSION, SCHEMA_VERSION, flags.require), db: null };
  // A bad setting stops the command here, naming it, instead of turning into NaN deep inside one.
  config();
  const db = openDb();
  const command = lookup(noun, verb);
  if (!command) throw new HqError('bad_args', `unknown command: ${noun}. Try hq help`);
  return { out: await command.handler({ db, noun, verb, rest, flags, run: runner }), db };
}

// `hq outbox flush --ids 1,2`: the detached unit sends only the rows of the command that started it.
function idsFlag(raw: string): number[] {
  const parts = raw.split(',');
  if (!parts.every((p) => /^[1-9]\d{0,15}$/.test(p))) throw new HqError('bad_args', '--ids must be outbox ids, like 3,4');
  return parts.map(Number);
}

// The runner reaches hq review and hq noslop; a test passes a fake one.
// oxlint-disable-next-line zgeoff/function-verb -- the entry point that the bin and every CLI test call
export async function main(argv: string[], runner: Runner = realRunner): Promise<number> {
  const json = argv.includes('--json');
  writeClockWarnings(process.env, (line) => console.error(line));
  takeQueued(); // ids left by an earlier call in this process (a test, or one that threw) are not this command's
  try {
    const ran = await runArgv(argv, runner);
    let flushed: FlushResult | null = null;
    let detached: DetachResult | null = null;
    if (ran.db) {
      // A command sends only the rows it queued; one that queued nothing sends nothing.
      // Only `hq outbox flush` (and the watcher) sends what other commands left pending.
      const { positionals: [noun, verb], values } = parse(argv);
      const flushCmd = noun === 'outbox' && verb === 'flush';
      const mine = takeQueued();
      const scope = flushCmd ? (values.ids === undefined ? 'all' : idsFlag(values.ids)) : mine;
      if (scope === 'all' || scope.length > 0) {
        ({ flushed, detached } = await send(ran.db, scope, flushCmd && values.retry === true, realRunner));
      }
      ran.db.close();
    }
    const notified = flushed ? { ...flushed, ...(detached?.unit ? { detached: detached.unit } : detached ? { detachError: detached.error } : {}) } : null;
    if (json) {
      console.log(JSON.stringify({ ok: true, ...ran.out.data, ...(notified ? { notified } : {}) }, null, 2));
    } else {
      console.log(ran.out.text + flushNote(flushed));
    }
    return 0;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const err = e instanceof HqError ? e : new HqError(code.startsWith('ERR_PARSE_ARGS') ? 'bad_args' : 'internal', String((e as Error).message ?? e));
    if (json) console.log(JSON.stringify({ ok: false, error: { code: err.code, message: err.message, ...(err.data ?? {}) } }, null, 2));
    else console.error(`hq: ${err.message}`);
    return err.code === 'internal' ? 2 : 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
