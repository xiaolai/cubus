#!/usr/bin/env bash
# Sample this host's temperatures beside a training run, to a file, forever.
#
#     ml/thermal-log.sh /path/to/thermal.csv [interval-seconds]
#
# WHY THIS EXISTS. trainer-b has hard-reset seven times during this work and not one of those resets
# left a temperature reading behind. That is the whole reason the cause was never found: each
# attempt explained the resets with a CONFIGURATION variable -- deep idle, an uncapped clock, the
# 896px arm, memory bandwidth -- and each was falsified by the next reset, because nobody was
# measuring the one quantity an operator could feel by hand. The owner put a hand on the box on
# 2026-09-10 and reported it too hot, which is more evidence than seven resets had produced.
#
# The file is the point, not the console. A host that dies takes its container logs' last buffered
# lines with it, but a line already fsynced to disk survives -- so this appends and flushes every
# sample, and the last row before a reset is the reading that matters.
#
# It deliberately does NOT act on what it reads. A watchdog that halts training on a temperature
# would be guessing at a threshold nobody has established yet; the first job is to find out what
# the trajectory into a reset actually looks like.
set -u

OUT="${1:?usage: thermal-log.sh <csv-path> [interval]}"
INTERVAL="${2:-30}"

# `set -e` is deliberately NOT on: a missing sensor is normal and must not end the log. So the two
# failures that DO matter are checked by hand. An interval that is not a positive whole number made
# `sleep` fail instantly and the loop spin; an unwritable path left a live process appending
# nothing, which from the outside looks exactly like a logger doing its job.
case "$INTERVAL" in
  '' | *[!0-9]* | 0) echo "thermal-log.sh: interval must be a positive whole number of seconds, not '$INTERVAL'" >&2; exit 2 ;;
esac
write_row() { printf '%s\n' "$1" >> "$OUT" || { echo "thermal-log.sh: cannot write $OUT -- stopping rather than logging nothing" >&2; exit 1; }; }

if [ ! -s "$OUT" ]; then
  zones=$(for z in /sys/class/thermal/thermal_zone*; do basename "$z"; done | paste -sd, -)
  write_row "utc,gpu_c,power_w,clock_mhz,util_pct,$zones"
fi

while :; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  gpu=$(nvidia-smi --query-gpu=temperature.gpu,power.draw,clocks.current.graphics,utilization.gpu \
        --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  [ -z "$gpu" ] && gpu=",,,"
  # millidegrees to degrees, one decimal, in the same order as the header
  # The trailing newline in the awk printf is load-bearing: `paste -sd, -` joins LINES, so without
  # it every zone landed in one field and the row carried one column where the header declared
  # seven. That is the corruption this whole file exists to avoid -- a log that looks written and
  # cannot be read is worse than no log, because it is only discovered when it is needed.
  zones=$(for z in /sys/class/thermal/thermal_zone*/temp; do
            v=$(cat "$z" 2>/dev/null || echo "")
            if [ -n "$v" ]; then awk -v m="$v" 'BEGIN{printf "%.1f\n", m/1000}'; else echo ""; fi
          done | paste -sd, -)
  write_row "$ts,$gpu,$zones"
  sync -d "$OUT" 2>/dev/null || true
  sleep "$INTERVAL" || exit 1
done
