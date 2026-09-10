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

if [ ! -s "$OUT" ]; then
  zones=$(for z in /sys/class/thermal/thermal_zone*; do basename "$z"; done | paste -sd, -)
  printf 'utc,gpu_c,power_w,clock_mhz,util_pct,%s\n' "$zones" >> "$OUT"
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
  printf '%s,%s,%s\n' "$ts" "$gpu" "$zones" >> "$OUT"
  sync -d "$OUT" 2>/dev/null || true
  sleep "$INTERVAL"
done
