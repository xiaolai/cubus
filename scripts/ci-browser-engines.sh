#!/usr/bin/env bash
# Playwright's WebKit and Chromium for the browser suites, with their Ubuntu packages taken from a
# deb cache that the workflow restores before this script and saves after it (.github/workflows/ci.yml).
#
# WHY. `playwright install --with-deps` downloads ~116 MB of .debs from the runner's Ubuntu mirror on
# every run. Twice on 2026-10-22 that mirror served them at 67.6 kB/s: a 29-minute step that left the
# suites cancelled (run 39781980729), then the step's own 10-minute bound firing (run 39832474206).
# This keeps those .debs in apt's OWN archive directory, so apt downloads only a package whose version
# the archive has moved since the cache was saved, and usually that is none.
#
# THE CACHE IS A HINT, NEVER A SOURCE OF TRUTH. Playwright's command is unchanged, and apt resolves
# against the live index as before. It uses a cached file only when its name and checksum match the
# version the index names, so a stale or foreign cache costs a download and never a different install.
# The installed set, the fonts among it, is therefore exactly what the uncached command installs.
#
# Writes `changed=true|false` to $GITHUB_OUTPUT: whether the cache's contents moved, so the workflow
# saves a new entry only then. A run that fails or times out here writes nothing, and the workflow saves
# anyway: every .deb apt finished is already in the directory, so the next run resumes the download.
set -euo pipefail
# One collation for every sort, comm and join below.
export LC_ALL=C

debs="${BROWSER_DEBS:-$HOME/.cache/cubus-browser-debs}"
conf=/etc/apt/apt.conf.d/99cubus-browser-debs

# apt downloads into partial/ as its sandbox user, then moves the finished file up.
mkdir -p "$debs/partial"
sudo chown _apt "$debs/partial"

lines() { if [ -z "$1" ]; then echo 0; else printf '%s\n' "$1" | wc -l; fi; }
deb_names() { find "$debs" -maxdepth 1 -name '*.deb' -printf '%f\n' | sort; }
# Every installed package as `name:arch version`, the key a .deb is matched by below.
installed() {
  dpkg-query -W -f='${db:Status-Abbrev}|${Package}:${Architecture} ${Version}\n' \
    | awk -F'|' '$1 ~ /^ii/ { print $2 }' | sort -u
}

restored="$(deb_names)"
before="$(installed)"
echo "restored $(lines "$restored") .debs from the cache"

# The drop-in exists only for this one command: the icons step's apt call later in the job must not
# land in the cache, so it is removed on every exit path.
trap 'sudo rm -f "$conf"' EXIT
printf 'Dir::Cache::Archives "%s/";\nAPT::Keep-Downloaded-Packages "true";\n' "$debs" | sudo tee "$conf" >/dev/null
pnpm --filter cubus-web exec playwright install --with-deps webkit chromium
sudo rm -f "$conf"

now="$(installed)"
# `name:arch version<TAB>file` for every .deb in the cache.
# shellcheck disable=SC2016 # ${Package} and the rest are dpkg-deb's format fields, not the shell's
index="$(for f in "$debs"/*.deb; do
  [ -e "$f" ] || continue
  printf '%s\t%s\n' "$(dpkg-deb --show --showformat='${Package}:${Architecture} ${Version}' "$f")" "$f"
done | sort)"

# LOUD, NOT QUIET: a package this step installed whose .deb is not in the cache means apt did not use
# the directory, and the next run would download it again while every step here still looked green.
missing="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$now") \
  | comm -23 - <(cut -f1 <<<"$index" | sort -u))"
if [ -n "$missing" ]; then
  echo "::error::installed without passing through the deb cache at $debs: $(tr '\n' ' ' <<<"$missing")"
  exit 1
fi

# Prune what is no longer installed at that version, so the cache holds one set rather than its history.
stale="$(join -t $'\t' -v1 <(printf '%s\n' "$index") <(printf '%s\n' "$now") | cut -f2)"
if [ -n "$stale" ]; then
  printf '%s\n' "$stale" | xargs rm -f
fi

downloaded="$(comm -13 <(printf '%s\n' "$restored") <(deb_names))"
echo "downloaded $(lines "$downloaded") .debs from the mirror, pruned $(lines "$stale") stale ones, cache holds $(deb_names | wc -l)"
if [ -n "$downloaded" ]; then
  while IFS= read -r name; do echo "  $name"; done <<<"$downloaded"
fi
if [ -n "$downloaded$stale" ]; then changed=true; else changed=false; fi
echo "changed=$changed" >> "${GITHUB_OUTPUT:-/dev/null}"
