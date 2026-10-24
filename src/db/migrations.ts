// Each entry moves the schema one version up. Append only; never edit a shipped one.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE asks (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('call', 'proposal')),
    title        TEXT NOT NULL,
    question     TEXT NOT NULL,
    body         TEXT NOT NULL,
    issues       TEXT NOT NULL DEFAULT '[]',
    filed_by     TEXT NOT NULL,
    for_session  TEXT,
    state        TEXT NOT NULL CHECK (state IN ('queued','open','answered','applied','later','skipped','closed')),
    round        INTEGER NOT NULL DEFAULT 1,
    due_at       TEXT,
    answer       TEXT,
    answered_at  TEXT,
    applied_to   TEXT,
    applied_note TEXT,
    applied_at   TEXT,
    close_reason TEXT,
    queued_at    TEXT NOT NULL,
    opened_at    TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  -- One open question to the owner at a time, across calls and proposals.
  CREATE UNIQUE INDEX asks_one_open ON asks (state) WHERE state = 'open';

  CREATE TABLE unblocks (
    id         TEXT PRIMARY KEY,
    task       TEXT NOT NULL,
    minutes    INTEGER,
    unblocks   TEXT NOT NULL DEFAULT '[]',
    rank       INTEGER,
    notify     TEXT NOT NULL DEFAULT '[]',
    added_by   TEXT NOT NULL,
    state      TEXT NOT NULL CHECK (state IN ('open','done','dropped')),
    added_seq  INTEGER NOT NULL,
    added_at   TEXT NOT NULL,
    closed_at  TEXT,
    note       TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    subject    TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    action     TEXT NOT NULL,
    from_state TEXT,
    to_state   TEXT,
    actor      TEXT NOT NULL,
    at         TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX events_subject ON events (subject, subject_id);

  CREATE TABLE outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_seq  INTEGER NOT NULL REFERENCES events (seq),
    target     TEXT NOT NULL,
    text       TEXT NOT NULL,
    idem_key   TEXT NOT NULL UNIQUE,
    status     TEXT NOT NULL CHECK (status IN ('pending','sent','failed')),
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    message_id TEXT,
    created_at TEXT NOT NULL,
    sent_at    TEXT
  );
  `,
  // v2: the send order z-triage's check (z-refine's, before the merge) computes each run. Lower opens first.
  `ALTER TABLE asks ADD COLUMN send_order INTEGER;`,
  // v3: the sessions hq wake messages after every daemon restart.
  `CREATE TABLE wake_list (
    session_id TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    note       TEXT,
    added_by   TEXT NOT NULL,
    added_at   TEXT NOT NULL
  );`,
  // v4: hq lanes. Each capacity sample, and each nudge with what followed it.
  `CREATE TABLE lanes_samples (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    free_mib  INTEGER,
    slots     INTEGER NOT NULL,
    eligible  INTEGER,
    error     TEXT
  );
  CREATE TABLE lanes_nudges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    slots        INTEGER NOT NULL,
    free_minutes INTEGER NOT NULL,
    eligible     INTEGER,
    event_seq    INTEGER NOT NULL,
    slots_after  INTEGER,
    checked_at   TEXT
  );`,
  // v5: z-delivery's running work (the Running table), and outbox topics so
  // only the newest unsent message on a topic goes out.
  `ALTER TABLE outbox ADD COLUMN topic TEXT;
  UPDATE outbox SET topic = 'lanes' WHERE event_seq IN
    (SELECT seq FROM events WHERE subject = 'hq' AND subject_id = 'lanes' AND action = 'nudged');
  UPDATE outbox SET topic = 'queue-reminder' WHERE event_seq IN (SELECT seq FROM events WHERE action = 'reminded');
  CREATE TABLE runs (
    issue       TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    place       TEXT NOT NULL CHECK (place IN ('local', 'imp', 'none')),
    state       TEXT NOT NULL CHECK (state IN ('working','blocked','merged','deploying','deploy-held','live-check','done','dropped')),
    next        TEXT NOT NULL DEFAULT '',
    gate        TEXT,
    geoff_chat  INTEGER NOT NULL DEFAULT 0,
    waits_on    TEXT,
    close_note  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    closed_at   TEXT
  );
  CREATE TABLE run_sessions (
    session_id TEXT PRIMARY KEY,
    issue      TEXT NOT NULL REFERENCES runs (issue),
    active     INTEGER NOT NULL DEFAULT 1,
    added_at   TEXT NOT NULL,
    ended_at   TEXT
  );
  CREATE UNIQUE INDEX run_sessions_one_active ON run_sessions (issue) WHERE active = 1;
  CREATE TABLE run_prs (
    ref               TEXT PRIMARY KEY,
    issue             TEXT NOT NULL REFERENCES runs (issue),
    url               TEXT,
    state             TEXT NOT NULL CHECK (state IN ('open','merged','closed')),
    final_sha         TEXT,
    final_at          TEXT,
    final_source      TEXT,
    review_started_at TEXT,
    reviewed_sha      TEXT,
    review_round      INTEGER NOT NULL DEFAULT 0,
    reviewed_at       TEXT,
    merged_at         TEXT,
    added_at          TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE TABLE run_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue      TEXT NOT NULL REFERENCES runs (issue),
    session_id TEXT,
    label      TEXT,
    text       TEXT NOT NULL,
    source     TEXT NOT NULL CHECK (source IN ('atc', 'cli')),
    event_key  TEXT UNIQUE,
    at         TEXT NOT NULL
  );
  CREATE INDEX run_notes_issue ON run_notes (issue, id);
  CREATE TABLE run_alerts (
    key         TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    sent_at     TEXT NOT NULL,
    event_seq   INTEGER
  );`,
  // v6: a row may hold helper sessions next to its main one, all watched.
  `DROP INDEX run_sessions_one_active;
  ALTER TABLE run_sessions ADD COLUMN helper INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX run_sessions_one_main ON run_sessions (issue) WHERE active = 1 AND helper = 0;`,

  // v7: news for the owner, read in a digest instead of a message each.
  `CREATE TABLE news (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_name   TEXT NOT NULL,
    topic       TEXT NOT NULL CHECK (topic IN ('merge', 'release', 'deploy', 'fix', 'other')),
    text        TEXT NOT NULL,
    issue       TEXT,
    link        TEXT,
    needs_geoff INTEGER NOT NULL DEFAULT 0,
    added_at    TEXT NOT NULL,
    read_at     TEXT
  );
  CREATE INDEX news_unread ON news (read_at, id);`,

  // v8: stats inputs. Change marks; when a run's issue became Ready; runs waiting on the owner, exactly.
  `CREATE TABLE marks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       TEXT NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('skills', 'grant', 'hq', 'other')),
    text     TEXT NOT NULL,
    ref      TEXT,
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL
  );
  CREATE INDEX marks_at ON marks (at);
  ALTER TABLE runs ADD COLUMN ready_since TEXT;
  ALTER TABLE runs ADD COLUMN waits_on_geoff INTEGER NOT NULL DEFAULT 0;`,
  // v9: triage's size guess for a run, as a band and a line count, for hq stats.
  `ALTER TABLE runs ADD COLUMN size TEXT CHECK (size IN ('S', 'M', 'L', 'XL'));
  ALTER TABLE runs ADD COLUMN size_lines INTEGER;`,

  // v10: lines typed into another session as the owner, with where they said them.
  `CREATE TABLE typed (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_session  TEXT NOT NULL,
    to_id       TEXT,
    to_name     TEXT,
    text        TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('call', 'proposal', 'chat')),
    source_ref  TEXT NOT NULL,
    source_at   TEXT,
    typed_by    TEXT NOT NULL,
    at          TEXT NOT NULL
  );
  CREATE INDEX typed_to ON typed (to_id, id);`,
  // v11: review follow-ups and same-PR fixes (GEO-998).
  `ALTER TABLE run_prs ADD COLUMN fixed_in_pr INTEGER;
  ALTER TABLE run_prs ADD COLUMN tally_at TEXT;
  CREATE TABLE followups (
    issue    TEXT PRIMARY KEY,
    from_ref TEXT,
    filed_at TEXT NOT NULL,
    source   TEXT NOT NULL CHECK (source IN ('final', 'linear backfill')),
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL
  );
  CREATE INDEX followups_filed ON followups (filed_at);`,
  // v12: runs of hq's scheduled jobs, one row per job and day (the morning reports first).
  `CREATE TABLE job_runs (
    job        TEXT NOT NULL,
    key        TEXT NOT NULL,
    at         TEXT NOT NULL,
    result     TEXT NOT NULL CHECK (result IN ('queued', 'skipped')),
    detail     TEXT,
    outbox_key TEXT,
    PRIMARY KEY (job, key)
  );`,
  // v13: a run's delivery lane (pacing.json lanes), filled from the lane notes z-delivery kept;
  // a run on this host with none is flexible. A nudge records the lanes it named.
  `ALTER TABLE runs ADD COLUMN lane TEXT;
  UPDATE runs SET lane = (
    SELECT lower(trim(n.text)) FROM run_notes n WHERE n.issue = runs.issue AND n.label = 'lane' ORDER BY n.id DESC LIMIT 1
  ) WHERE lane IS NULL;
  UPDATE runs SET lane = NULL WHERE lane IS NOT NULL AND (lane = '' OR lane GLOB '*[^a-z0-9-]*' OR length(lane) > 40);
  UPDATE runs SET lane = 'flexible' WHERE lane IS NULL AND place = 'local';
  ALTER TABLE lanes_nudges ADD COLUMN detail TEXT;`,
  // v14: every merged zgeoff PR with its kind (title prefix) and Linear issue; a day is in
  // merged_pr_days once it is fully fetched. linear_issues: each issue's Type label, and when it closed.
  `CREATE TABLE merged_prs (
    repo       TEXT NOT NULL,
    number     INTEGER NOT NULL,
    merged_at  TEXT NOT NULL,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    issue      TEXT,
    PRIMARY KEY (repo, number)
  );
  CREATE INDEX merged_prs_at ON merged_prs (merged_at);
  CREATE TABLE merged_pr_days (
    day TEXT PRIMARY KEY,
    n   INTEGER NOT NULL,
    at  TEXT NOT NULL
  );
  CREATE TABLE linear_issues (
    issue      TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    state      TEXT NOT NULL CHECK (state IN ('completed', 'canceled', 'open')),
    closed_at  TEXT,
    fetched_at TEXT NOT NULL
  );
  CREATE INDEX linear_issues_closed ON linear_issues (closed_at);`,
  // v15: a 'report' news topic (z-steward: the morning reports). SQLite can't change a CHECK, so
  // the table is rebuilt with every row and its id sequence kept; nothing references news.
  `CREATE TABLE news_v15 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_name   TEXT NOT NULL,
    topic       TEXT NOT NULL CHECK (topic IN ('merge', 'release', 'deploy', 'fix', 'report', 'other')),
    text        TEXT NOT NULL,
    issue       TEXT,
    link        TEXT,
    needs_geoff INTEGER NOT NULL DEFAULT 0,
    added_at    TEXT NOT NULL,
    read_at     TEXT
  );
  INSERT INTO news_v15 (id, from_name, topic, text, issue, link, needs_geoff, added_at, read_at)
    SELECT id, from_name, topic, text, issue, link, needs_geoff, added_at, read_at FROM news;
  CREATE TEMP TABLE news_seq AS SELECT seq FROM sqlite_sequence WHERE name = 'news';
  DROP TABLE news;
  ALTER TABLE news_v15 RENAME TO news;
  UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM news_seq), 0)) WHERE name = 'news';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'news', seq FROM news_seq WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'news');
  DROP TABLE news_seq;
  CREATE INDEX news_unread ON news (read_at, id);`,
  // v16: team-goals numbers (goals.ts): every zgeoff workflow run, PRs closed unmerged, and the
  // UTC days fetched in full (a past day is fetched once).
  `CREATE TABLE ci_runs (
    id         INTEGER PRIMARY KEY,
    repo       TEXT NOT NULL,
    path       TEXT NOT NULL,
    event      TEXT NOT NULL,
    status     TEXT NOT NULL,
    conclusion TEXT,
    attempt    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX ci_runs_created ON ci_runs (created_at);
  CREATE TABLE closed_prs (
    repo      TEXT NOT NULL,
    number    INTEGER NOT NULL,
    closed_at TEXT NOT NULL,
    PRIMARY KEY (repo, number)
  );
  CREATE INDEX closed_prs_at ON closed_prs (closed_at);
  CREATE TABLE goal_days (
    kind TEXT NOT NULL CHECK (kind IN ('ci', 'closed')),
    key  TEXT NOT NULL,
    day  TEXT NOT NULL,
    n    INTEGER NOT NULL,
    at   TEXT NOT NULL,
    PRIMARY KEY (kind, key, day)
  );`,
  // v17: the Nix uptime probe (probe.ts). control_ok is NULL when the control URL was not fetched.
  `CREATE TABLE probe_samples (
    at         TEXT PRIMARY KEY,
    target_ok  INTEGER NOT NULL,
    control_ok INTEGER,
    ms         INTEGER,
    detail     TEXT
  );
  CREATE TABLE outages (
    id           INTEGER PRIMARY KEY,
    started_at   TEXT NOT NULL,
    detected_at  TEXT NOT NULL,
    ended_at     TEXT,
    alert_seq    INTEGER,
    recover_seq  INTEGER
  );
  CREATE UNIQUE INDEX outages_one_open ON outages ((1)) WHERE ended_at IS NULL;`,
  // v18: a tag on a news item (the weekly review reads weekly-flag), and a Claude usage sample per
  // new reading of the capacity cache (goalcheck.ts). account is 'active' when the cache names none.
  `ALTER TABLE news ADD COLUMN tag TEXT;
  CREATE TABLE usage_samples (
    at        TEXT NOT NULL,
    account   TEXT NOT NULL,
    five_hour REAL,
    seven_day REAL,
    PRIMARY KEY (at, account)
  );`,
  // v19: the probe also checks /health/ready (ready_ok is NULL when it was not fetched, and for
  // samples from before v19). An outage has a kind: 'down' (every earlier row) or 'unready' (Nix
  // live but not ready), and one of each kind may be open at a time.
  `ALTER TABLE probe_samples ADD COLUMN ready_ok INTEGER;
  ALTER TABLE outages ADD COLUMN kind TEXT NOT NULL DEFAULT 'down' CHECK (kind IN ('down', 'unready'));
  DROP INDEX outages_one_open;
  CREATE UNIQUE INDEX outages_one_open ON outages (kind) WHERE ended_at IS NULL;`,
  // v20: release-aware runs. runs.live_check says whether a live check is owed after the release
  // ships (NULL is unset, treated as owed). run_prs keeps the merge commit and the first release
  // that contains it, so hq can move a run on once every merged PR has shipped.
  `ALTER TABLE runs ADD COLUMN live_check TEXT CHECK (live_check IN ('owed','none'));
  ALTER TABLE run_prs ADD COLUMN merge_sha TEXT;
  ALTER TABLE run_prs ADD COLUMN shipped_tag TEXT;
  ALTER TABLE run_prs ADD COLUMN shipped_at TEXT;`,
  // v21: what each completed cloud deploy-prod run did (goals.ts): applied, held, or nothing to
  // apply. Read from the run's jobs; a run with no row here, or a row for an earlier attempt, is not yet classified.
  `CREATE TABLE deploy_runs (
    run_id           INTEGER PRIMARY KEY,
    outcome          TEXT NOT NULL CHECK (outcome IN ('applied_ok', 'applied_failed', 'held', 'no_apply', 'cancelled', 'unknown')),
    attempt          INTEGER NOT NULL,
    apply_conclusion TEXT,
    failed_step      TEXT,
    fetched_at       TEXT NOT NULL
  );`,
  // v22: the refusal log (refusals.ts). refusals holds one redacted row per auto-mode refusal found
  // in a Claude transcript; refusal_files keeps how far into each transcript the scan has read, and
  // the recent tool_use ids there (name and masked input only) for a refusal the next scan finds.
  `CREATE TABLE refusal_files (
    path   TEXT PRIMARY KEY,
    offset INTEGER NOT NULL,
    size   INTEGER NOT NULL,
    mtime  TEXT NOT NULL,
    tools  TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE refusals (
    uuid           TEXT PRIMARY KEY,
    at             TEXT NOT NULL,
    claude_session TEXT,
    transcript     TEXT NOT NULL,
    subagent       INTEGER NOT NULL CHECK (subagent IN (0, 1)),
    cwd            TEXT,
    atc_session    TEXT,
    atc_name       TEXT,
    issue          TEXT,
    tool           TEXT,
    input          TEXT,
    reason         TEXT,
    scanned_at     TEXT NOT NULL
  );
  CREATE INDEX refusals_at ON refusals (at);`,

  // v23: the capacity watch (capacity.ts). One sample per watcher tick: impd memory, cloud memory,
  // Claude usage, CI minutes and the PC. errors holds {source: message} for each read that failed.
  `CREATE TABLE capacity_samples (
    at                 TEXT PRIMARY KEY,
    impd_budget_mib    INTEGER,
    impd_used_mib      INTEGER,
    impd_committed_mib INTEGER,
    nonnix_awake_mib   INTEGER,
    nix_awake_mib      INTEGER,
    cloud_avail_bytes  INTEGER,
    cloud_total_bytes  INTEGER,
    claude_account     TEXT,
    claude_five_hour   REAL,
    claude_seven_day   REAL,
    claude_at          TEXT,
    ci_minutes_today   INTEGER,
    pc_disk_free_bytes INTEGER,
    pc_mem_avail_bytes INTEGER,
    errors             TEXT NOT NULL DEFAULT '{}'
  );`,

  // v24: noslop rounds (src/noslop/). One row per noslop review or check run on a PR: review rows keep
  // the findings, check rows the conclusion and the findings still open. ok = 0 is a run that gave no
  // review (a failure, never a pass). sha is the pinned noslop commit that ran.
  `CREATE TABLE noslop_rounds (
    id           INTEGER PRIMARY KEY,
    repo         TEXT NOT NULL,
    pr           INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('review', 'check')),
    started_at   TEXT NOT NULL,
    ended_at     TEXT NOT NULL,
    ms           INTEGER NOT NULL,
    ok           INTEGER NOT NULL CHECK (ok IN (0, 1)),
    head         TEXT,
    base         TEXT,
    depth        TEXT,
    findings     TEXT NOT NULL DEFAULT '[]',
    failed_calls INTEGER NOT NULL DEFAULT 0,
    conclusion   TEXT,
    open         TEXT NOT NULL DEFAULT '[]',
    error        TEXT,
    sha          TEXT NOT NULL
  );
  CREATE INDEX noslop_rounds_pr ON noslop_rounds (repo, pr);`,

  // v25: whether a noslop review ran with --full (1) or on the new commits only (0). NULL on a
  // check, and on a review recorded before v25, when hq did not keep it.
  `ALTER TABLE noslop_rounds ADD COLUMN full INTEGER CHECK (full IN (0, 1));`,

  // v26: the console's structured items (item.ts). `item` holds an item's JSON fields; NULL is an
  // item filed as free text. `stu_view` is the owner's one or two sentences on a call or proposal. An
  // unblock item gains a short title and `due_at`, which hides it from the console until then.
  `ALTER TABLE asks ADD COLUMN item TEXT;
  ALTER TABLE asks ADD COLUMN stu_view TEXT;
  ALTER TABLE unblocks ADD COLUMN item TEXT;
  ALTER TABLE unblocks ADD COLUMN title TEXT;
  ALTER TABLE unblocks ADD COLUMN due_at TEXT;`,

  // v27: standing grants (grants/). A `grant` mark may carry a short unique name, and each action a
  // session takes under a named grant is appended to grant_actions, never changed or removed, for
  // the weekly report.
  `ALTER TABLE marks ADD COLUMN grant_name TEXT;
  CREATE UNIQUE INDEX marks_grant_name ON marks (grant_name) WHERE grant_name IS NOT NULL;
  CREATE TABLE grant_actions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    grant_name TEXT NOT NULL,
    target     TEXT NOT NULL,
    note       TEXT,
    actor      TEXT NOT NULL,
    at         TEXT NOT NULL
  );
  CREATE INDEX grant_actions_at ON grant_actions (at);`,

  // v28: a typed line's source may be a console answer (`console:<id>`). SQLite cannot change a
  // CHECK in place, so the table is copied into a new one, every row and id kept.
  `CREATE TABLE typed_v28 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_session  TEXT NOT NULL,
    to_id       TEXT,
    to_name     TEXT,
    text        TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('call', 'proposal', 'chat', 'console')),
    source_ref  TEXT NOT NULL,
    source_at   TEXT,
    typed_by    TEXT NOT NULL,
    at          TEXT NOT NULL
  );
  INSERT INTO typed_v28 (id, to_session, to_id, to_name, text, source_kind, source_ref, source_at, typed_by, at)
    SELECT id, to_session, to_id, to_name, text, source_kind, source_ref, source_at, typed_by, at FROM typed;
  DROP TABLE typed;
  ALTER TABLE typed_v28 RENAME TO typed;
  CREATE INDEX typed_to ON typed (to_id, id);`,

  // v29: the vCPUs of the non-Nix imps awake at each capacity sample, for the lanes' vCPU line.
  // NULL on a sample from before v29, or when an awake imp did not report its vCPUs.
  `ALTER TABLE capacity_samples ADD COLUMN nonnix_awake_vcpus INTEGER;`,

  // v30: a gate's check records the PR's state key and the check's title, so a later gate on an
  // unchanged PR answers from that check instead of running noslop again. NULL on other rounds.
  `ALTER TABLE noslop_rounds ADD COLUMN state_key TEXT;
  ALTER TABLE noslop_rounds ADD COLUMN title TEXT;`,

  // v31: the 1Password account's requests today, its daily limit, and whether any limit was spent
  // (1) at each capacity sample. NULL when op gave no reading.
  `ALTER TABLE capacity_samples ADD COLUMN op_account_used INTEGER;
  ALTER TABLE capacity_samples ADD COLUMN op_account_limit INTEGER;
  ALTER TABLE capacity_samples ADD COLUMN op_refused INTEGER CHECK (op_refused IN (0, 1));`,

  // v32: who ended a run session: 'sweep' when atc no longer listed it, so the sweep's exit alert
  // can tell a gone session from one ended by hand. NULL for every other end.
  `ALTER TABLE run_sessions ADD COLUMN ended_by TEXT CHECK (ended_by IN ('sweep'));`,

  // v33, the round cap. special: noslop's special route ('docs-only', 'sync', 'release'), 'none'
  // for none, NULL when not recorded (before v33, a check, a failed review). redesign: the finding
  // id a --redesign round was asked for, NULL on every other round.
  `ALTER TABLE noslop_rounds ADD COLUMN special TEXT;
  ALTER TABLE noslop_rounds ADD COLUMN redesign TEXT;`,

  // v34: 1 on a --confirm review, a check of the fixes past the cap that is not a round; 0 otherwise.
  `ALTER TABLE noslop_rounds ADD COLUMN confirm INTEGER NOT NULL DEFAULT 0 CHECK (confirm IN (0, 1));`,

  // v35: one record per PR that sessions read before messaging about it. head is the last head hq
  // saw; the gate and the owner's answer keep the head they were given at, so a newer head marks them
  // stale. Gate 'none' (no head) is a PR noslop does not review; next holds the next step.
  `CREATE TABLE pr_status (
    repo          TEXT NOT NULL,
    pr            INTEGER NOT NULL,
    head          TEXT,
    gate          TEXT CHECK (gate IN ('pass', 'fail', 'none')),
    gate_head     TEXT,
    gate_at       TEXT,
    answer        TEXT CHECK (answer IN ('lgtm', 'changes', 'reject')),
    answer_head   TEXT,
    answer_source TEXT,
    answer_note   TEXT,
    answer_at     TEXT,
    next          TEXT,
    next_at       TEXT,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (repo, pr)
  );`,

  // v36: what the console's Shipped report keeps between loads: a Sydney day's merged PRs, a Linear
  // issue, a project's issues. expires_at is NULL for an entry that never changes, such as a past
  // day or a Done issue.
  `CREATE TABLE shipped_cache (
    kind       TEXT NOT NULL CHECK (kind IN ('merged-day', 'issue', 'project')),
    key        TEXT NOT NULL,
    body       TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT,
    PRIMARY KEY (kind, key)
  );`,

  // v37: the conditions that settle an open unblock item by themselves, as a JSON array of
  // {kind: 'issue' | 'pr' | 'doc', ref}. NULL: none, so the item waits for the owner.
  `ALTER TABLE unblocks ADD COLUMN done_when TEXT;`,

  // v38: the check-in's throughput lines: each filed issue's source and the PR it points at (never
  // its description), the issues In Progress at the last read, and 'review' follow-ups. SQLite
  // can't change a CHECK, so followups is rebuilt with every row kept.
  `CREATE TABLE linear_filed (
    issue      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    source     TEXT NOT NULL CHECK (source IN ('owner', 'design', 'agent', 'live check', 'bot')),
    pr_ref     TEXT,
    fetched_at TEXT NOT NULL
  );
  CREATE INDEX linear_filed_created ON linear_filed (created_at);
  CREATE TABLE linear_started (
    issue      TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE followups_v38 (
    issue    TEXT PRIMARY KEY,
    from_ref TEXT,
    filed_at TEXT NOT NULL,
    source   TEXT NOT NULL CHECK (source IN ('final', 'linear backfill', 'review')),
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL
  );
  INSERT INTO followups_v38 (issue, from_ref, filed_at, source, added_by, added_at) SELECT issue, from_ref, filed_at, source, added_by, added_at FROM followups;
  DROP TABLE followups;
  ALTER TABLE followups_v38 RENAME TO followups;
  CREATE INDEX followups_filed ON followups (filed_at);`,

  // v39: the owner's focus for the lanes, one row while set. terms: the ordered terms as parsed
  // JSON; reserves: [{area, slots}]. hq focus clear deletes the row.
  `CREATE TABLE focus (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    terms    TEXT NOT NULL,
    reserves TEXT NOT NULL,
    set_at   TEXT NOT NULL,
    set_by   TEXT NOT NULL
  );`,

  // v40: watch items. kind: 'owner' for an item that needs the owner's hands, 'watch' for one that
  // waits on an event and stays off the owner's lists. deadline: the ISO time past which the item is
  // overdue; overdue_told_at: when hq told the sessions so, NULL until then.
  `ALTER TABLE unblocks ADD COLUMN kind TEXT NOT NULL DEFAULT 'owner' CHECK (kind IN ('owner', 'watch'));
  ALTER TABLE unblocks ADD COLUMN deadline TEXT;
  ALTER TABLE unblocks ADD COLUMN overdue_told_at TEXT;`,

  // v41: when each Claude usage window resets, from capacity.sh's cache; NULL when the cache gave
  // none, and for every row from before v41.
  `ALTER TABLE usage_samples ADD COLUMN five_hour_resets_at TEXT;
  ALTER TABLE usage_samples ADD COLUMN seven_day_resets_at TEXT;
  ALTER TABLE capacity_samples ADD COLUMN claude_five_hour_resets_at TEXT;
  ALTER TABLE capacity_samples ADD COLUMN claude_seven_day_resets_at TEXT;`,

  // v42: slot-minutes by cause per Sydney day: the minutes the lanes' free slots sat empty, tagged
  // with why. Each lanes look adds onto the day it falls in.
  `CREATE TABLE slot_minutes (
    day     TEXT NOT NULL,
    cause   TEXT NOT NULL CHECK (cause IN ('delivery', 'triage', 'supply')),
    minutes REAL NOT NULL,
    PRIMARY KEY (day, cause)
  );`,

  // v43: voiding a grant action logged in error. The row stays; voided_at, voided_by and void_reason
  // are NULL on a live action and on every row from before v43.
  `ALTER TABLE grant_actions ADD COLUMN voided_at TEXT;
  ALTER TABLE grant_actions ADD COLUMN voided_by TEXT;
  ALTER TABLE grant_actions ADD COLUMN void_reason TEXT;`,
];
