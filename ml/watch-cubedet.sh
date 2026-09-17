#!/usr/bin/env bash
# Per-arm state is held in variables named after the arm and reached through eval, so adding an arm
# needs no new code. shellcheck cannot see through eval and reports every one as unassigned; the
# alternative spellings (associative arrays, temp files) cost more than the noise is worth.
# shellcheck disable=SC2154
# Watch both cubedet arms to a terminal state. One stdout line per state CHANGE only.
#
# SILENCE IS NOT SUCCESS HERE. A GB10 hard reset has taken this work down six times, and it kills
# a run without any error the trainer can print. A watcher that only greps for completion would be
# silent in exactly that case, and silence looks identical to "still training". So every outcome
# emits: finished, crashed, restarted, and host-unreachable alike.
#
# WHAT COUNTS AS TERMINAL CHANGED when the containers gained --restart on-failure:10. An exited
# container is now usually a RECOVERING one, so exit alone must not end the watch:
#   finished  epochs reached the target -- the only definition that does not depend on container
#             state, which is what makes it right for a container that restarts under us
#   failed    exited non-zero and STILL exited three polls later, so nothing is restarting it
#             (P_large predates the policy and is genuinely terminal on first exit; the same rule
#             covers both without special-casing, just three polls slower for one of them)
#   a reset   is reported and then WATCHED THROUGH, because it is now survivable
#
# NEVER READ PROGRESS FROM `docker logs`, which is why this counts epochs in history.json.
# An unclean shutdown leaves a partial line in the container's json log, and `docker logs` parses
# from the start and stops SILENTLY at the corruption -- so after a host reset it reads as frozen
# at the moment of death while the container is running perfectly. Measured 2026-09-10: P_small,
# restarted after a reset, reported epoch 43 by that route against a true 60, while P_large, never
# restarted, reported 55 against a true 56. `docker logs --tail N` seeks from the end and is
# unaffected, but the file the trainer writes is the only source that cannot drift.
set -u

POLL=300
HEARTBEAT_TICKS=24        # every 2h, so a quiet watch still proves it is alive
# Overridable, because the arms and the schedule change per experiment and a watcher that needs
# editing to be reused is a watcher that gets skipped.
TARGET_EPOCHS="${CUBEDET_TARGET_EPOCHS:-80}"
ARMS="${CUBEDET_ARMS:-trainer-a:P_large trainer-b:P_small}"

# Extra ssh options, so a broken direct route does not end the watch. On 2026-09-11 this laptop
# lost its path to trainer-a while trainer-b and render-box could both still reach it and the box was
# up 32 days -- the host was fine and only the route was not. CUBEDET_SSH_OPTS="-J trainer-b" keeps
# the watch alive through a jump rather than reporting a healthy run as a dead host.
# shellcheck disable=SC2086
ssh_q() { ssh -o BatchMode=yes -o ConnectTimeout=15 ${CUBEDET_SSH_OPTS:-} "$1" "$2" 2>/dev/null; }

arm_state() {   # host run -> "<status> <exitcode> <restarts> <epochs>"
  local host=$1 run=$2 raw ep
  raw=$(ssh_q "$host" "docker inspect cubedet_${run} --format '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}'")
  # ssh exits 255 when IT fails and passes the remote status through otherwise. Every empty answer
  # used to read as "unreachable", so a healthy host with no such container -- a typo in ARMS, a
  # run already removed -- was reported as a host that had gone down.
  local rc=$?
  if [ "$rc" -eq 255 ]; then echo "unreachable - - -"; return; fi
  if [ -z "$raw" ]; then echo "missing - - -"; return; fi
  ep=$(ssh_q "$host" "grep -o '\"epoch\"' ~/cubus-ml/out/${run}/history.json 2>/dev/null | wc -l | tr -d ' '")
  [ -z "$ep" ] && ep=0
  echo "$raw $ep"
}

# Derived from ARMS, not hardcoded: with `set -u` an arm the loop forgot dies on its first
# poll with 'unbound variable', which is how making ARMS configurable broke this the first time.
#
# Every run name becomes part of a VARIABLE NAME through eval below, so it is checked first. A name
# with `-` or `.` -- both legal for docker -- made the assignment a syntax error on the first poll,
# and one carrying shell metacharacters would have been executed. bash 3.2 (the laptop this runs on)
# has no associative arrays, so constraining the name is the fix rather than a different store.
for pair in $ARMS; do
  r=${pair##*:}
  case "$r" in
    '' | [0-9]* | *[!A-Za-z0-9_]*) echo "watch-cubedet.sh: run name '$r' must be letters, digits and _ (not starting with a digit)" >&2; exit 2 ;;
  esac
done
for pair in $ARMS; do r=${pair##*:}; eval "done_${r}=''; miss_${r}=0; exited_${r}=0; rc_${r}=-1; ep_${r}=-1; loop_${r}=0"; done
ticks=0

while :; do
  live=0
  for pair in $ARMS; do
    host=${pair%%:*}; run=${pair##*:}
    eval "fin=\$done_${run}"
    [ -n "$fin" ] && continue
    live=1

    read -r status code restarts ep <<<"$(arm_state "$host" "$run")"

    if [ "$status" = "unreachable" ]; then
      eval "m=\$((miss_${run} + 1)); miss_${run}=\$m"
      # Two consecutive misses ten minutes apart is a host down, not a network blip. Reported and
      # then watched through: the restart policy is expected to resume it when the box returns.
      [ "$m" = "2" ] && echo "$run on $host is UNREACHABLE -- host looks down; the restart policy should resume it from last.pt when it returns"
      continue
    fi
    eval "miss_${run}=0"

    if [ "$status" = "missing" ]; then
      echo "$run on $host has NO CONTAINER named cubedet_${run} -- the host answered; check ARMS or whether the run was removed"
      continue
    fi

    if [ "$ep" -ge "$TARGET_EPOCHS" ]; then
      echo "$run on $host FINISHED: $ep/$TARGET_EPOCHS epochs"
      eval "done_${run}=1"
      continue
    fi

    # A CRASH LOOP IS "RESTARTS CLIMBING WHILE EPOCHS STAND STILL", and it has to be detected that
    # way rather than by counting consecutive bad statuses. A fast loop oscillates through
    # restarting / exited / briefly running, so any consecutive-status counter keeps resetting and
    # never fires -- measured 2026-09-10 against a deliberately seeded crash-looper, which the
    # status-based version watched for 40 seconds and never called broken. Restart count is
    # monotonic and epoch progress is the discriminator that separates a loop from a healthy
    # resume after a host reset.
    eval "prev_rc=\$rc_${run}; prev_ep=\$ep_${run}; loops=\$loop_${run}"
    if [ "$prev_rc" != "-1" ] && [ "$restarts" -gt "$prev_rc" ]; then
      if [ "$ep" -gt "$prev_ep" ]; then
        loops=0
        echo "$run on $host was RESTARTED (#$restarts) and resumed, now at epoch $ep"
      else
        loops=$((loops + 1))
        echo "$run on $host was RESTARTED (#$restarts) with no progress past epoch $ep"
      fi
    elif [ "$ep" -gt "$prev_ep" ]; then
      loops=0
    fi
    eval "rc_${run}=$restarts; ep_${run}=$ep; loop_${run}=$loops"
    if [ "$loops" -ge 3 ]; then
      echo "$run on $host FAILED: restarting repeatedly without progressing past epoch $ep/$TARGET_EPOCHS"
      eval "done_${run}=1"
      continue
    fi

    # `restarting` counts as failing, not as running. unless-stopped restarts a container forever,
    # so a PERSISTENT fault -- a missing data file, a bad path -- presents as a container that is
    # always about to start and never progresses. Without this it heartbeats "restarting" for the
    # life of the watch and nothing ever calls it broken. Cost this exactly once, on 2026-09-10,
    # when a real-only dataset built from symlinks pointed outside the container's mount.
    if { [ "$status" = "exited" ] && [ "$code" != "0" ]; } || [ "$status" = "restarting" ]; then
      eval "x=\$((exited_${run} + 1)); exited_${run}=\$x"
      if [ "$x" -ge 3 ]; then
        echo "$run on $host FAILED: $status (exit $code, $restarts restarts) stuck at epoch $ep/$TARGET_EPOCHS across three checks"
        eval "done_${run}=1"
      fi
    elif [ "$status" = "exited" ] && [ "$code" = "0" ]; then
      echo "$run on $host exited cleanly at epoch $ep/$TARGET_EPOCHS, short of the target -- treating as done"
      eval "done_${run}=1"
    else
      eval "exited_${run}=0"
    fi
  done

  [ "$live" = "0" ] && { echo "both arms reached a terminal state"; exit 0; }

  ticks=$((ticks + 1))
  if [ $((ticks % HEARTBEAT_TICKS)) -eq 0 ]; then
    line=""
    for p in $ARMS; do
      h=${p%%:*}; r=${p##*:}
      # Splitting the four fields is the point here, so the lack of quotes is deliberate.
      # shellcheck disable=SC2046
      set -- $(arm_state "$h" "$r")
      line="$line $r=$1@${4}/${TARGET_EPOCHS}"
    done
    echo "still training:$line"
  fi
  sleep "$POLL"
done
