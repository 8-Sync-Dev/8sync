#!/usr/bin/env bash
# Emulator UAT for the 8 Sync HQ APK, run by .github/workflows/hq-android.yml
# inside reactivecircus/android-emulator-runner:
#   install → launch (connect.png) → type a stand-in HQ address + Enter, which
#   goes through the Rust `open_hq` navigation (hq.png) → Android Back returns
#   to the connect screen with the address under "Gần đây" (back.png) →
#   relaunch in dark mode (connect-dark.png).
# Fails when the app is not running after a step or logcat has a crash for it.
#
#   bash apps/hq-android/uat.sh <apk> <out-dir> [stand-in-address]
set -euo pipefail

apk=$1
out=$2
address=${3:-get.8syncdev.com}
pkg=com.eightsyncdev.hq
# Plain-ASCII text that only the connect screen shows (its Tailscale hint).
marker="hq ui --tailnet"

mkdir -p "$out"

fail() {
  echo "::error::$*"
  adb logcat -d -b all > "$out/logcat.txt" 2>&1 || true
  exit 1
}

shot() {
  adb exec-out screencap -p > "$out/$1.png"
  echo "screenshot $1.png ($(wc -c < "$out/$1.png") B)"
}

# Accessibility tree as XML (the WebView exposes its DOM text to it). uiautomator
# needs an idle UI, so retry a few times; empty output when it never settles.
dump() {
  for _ in 1 2 3 4 5; do
    if adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; then
      adb exec-out cat /sdcard/ui.xml
      return
    fi
    sleep 2
  done
}

alive() {
  local pid crash
  pid=$(adb shell pidof "$pkg" | tr -d '\r' || true)
  crash=$(adb logcat -d -b crash | grep -F "$pkg" || true)
  [ -z "$crash" ] || fail "crash after $1: $crash"
  [ -n "$pid" ] || fail "$pkg is not running after $1"
  echo "alive after $1 (pid $pid)"
}

adb install -r "$apk"
adb logcat -b all -c

adb shell am start -W -n "$pkg/.MainActivity"
sleep 8
alive launch
shot connect

ui=$(dump)
echo "$ui" > "$out/connect.xml"
if grep -qF "$marker" <<< "$ui"; then a11y=1; else a11y=0; echo "::warning::connect screen text not in the accessibility dump; navigation checks rely on screenshots only"; fi

# Focus the address field: tap the EditText the dump reports, else Tab into it
# (it is the first focusable element of the page).
bounds=$(python3 - "$out/connect.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for node in re.findall(r"<node [^>]*>", xml):
    if 'class="android.widget.EditText"' in node:
        m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
)
if [ -n "$bounds" ]; then
  echo "tapping the address field at $bounds"
  adb shell input tap $bounds
else
  echo "no EditText in the dump; focusing with Tab"
  adb shell input keyevent 61
fi
sleep 1
adb shell input text "$address"
sleep 1
adb shell input keyevent 66 # Enter submits the form → hq_origin + open_hq (Rust)
sleep 15
alive "open $address"
shot hq
ui=$(dump)
echo "$ui" > "$out/hq.xml"
if [ "$a11y" = 1 ] && grep -qF "$marker" <<< "$ui"; then
  fail "still on the connect screen after submitting $address"
fi

adb shell input keyevent 4 # Back at the HQ root → connect screen
sleep 5
alive back
shot back
ui=$(dump)
echo "$ui" > "$out/back.xml"
if [ "$a11y" = 1 ]; then
  grep -qF "$marker" <<< "$ui" || fail "Back did not return to the connect screen"
  grep -qF "$address" <<< "$ui" || fail "$address missing from the recent list"
fi

adb shell cmd uimode night yes
adb shell am force-stop "$pkg"
adb shell am start -W -n "$pkg/.MainActivity"
sleep 6
alive "dark relaunch"
shot connect-dark
adb shell cmd uimode night no

adb logcat -d -b all > "$out/logcat.txt" 2>&1 || true
echo "UAT passed"
