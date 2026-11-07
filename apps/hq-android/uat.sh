#!/usr/bin/env bash
# Emulator UAT for the 8 Sync HQ APK, run by .github/workflows/hq-android.yml
# inside reactivecircus/android-emulator-runner (pixel_6 profile, 1080x2400):
#   install → launch (connect.png) → type a stand-in HQ address, tap "Mở HQ",
#   which goes through the Rust `hq_origin`/`open_hq` commands (hq.png) → Back
#   returns to the connect screen, address now under "Gần đây" (back.png) →
#   relaunch in dark mode (connect-dark.png).
# Fails when the app is not running after a step, logcat has a crash for it, or
# a step leaves the screen unchanged (navigation / Back did nothing).
#
#   bash apps/hq-android/uat.sh <apk> <out-dir> [stand-in-address]
set -euo pipefail

apk=$1
out=$2
address=${3:-get.8syncdev.com}
pkg=com.eightsyncdev.hq
# Centres of the address field and the "Mở HQ" button on the pixel_6 profile,
# measured on its screenshots (the WebView DOM is not in the accessibility tree,
# so they cannot be looked up; layout = apps/hq-android/ui).
field_x=540
field_y=612
button_y=765

mkdir -p "$out"

# Every adb call is bounded: a dropped emulator connection must fail the job,
# not hang it.
a() {
  local i
  for i in 1 2 3; do
    if timeout 60 adb "$@"; then return 0; fi
    echo "adb $* failed ($i/3); reconnecting"
    adb reconnect offline > /dev/null 2>&1 || true
    timeout 120 adb wait-for-device || true
  done
  return 1
}

fail() {
  echo "::error::$*"
  timeout 30 adb logcat -d -b all > "$out/logcat.txt" 2>&1 || true
  exit 1
}

# PNG for the artifact plus a raw RGBA copy for the pixel comparisons below.
shot() {
  a exec-out screencap -p > "$out/$1.png"
  a exec-out screencap > "$out/$1.raw"
  echo "screenshot $1.png ($(wc -c < "$out/$1.png") B)"
}

# Share of pixels that differ between two raw screencaps, below the status bar
# (its clock changes between shots). Prints a percentage.
diff_pct() {
  python3 - "$out/$1.raw" "$out/$2.raw" <<'PY'
import struct, sys
a, b = (open(p, "rb").read() for p in sys.argv[1:3])
w, h = struct.unpack_from("<II", a)
head = len(a) - w * h * 4            # 12- or 16-byte header, by Android version
start, stride = head + w * 4 * 200, 4 * 8   # skip 200 status-bar rows; sample every 8th pixel
pa, pb = a[start:], b[start:]
n = len(pa) // stride
diff = sum(1 for i in range(0, n * stride, stride) if pa[i:i + 3] != pb[i:i + 3])
print(round(100 * diff / n, 1))
PY
}

alive() {
  local pid crash
  pid=$(timeout 30 adb shell pidof "$pkg" | tr -d '\r' || true)
  crash=$(timeout 30 adb logcat -d -b crash | grep -F "$pkg" || true)
  [ -z "$crash" ] || fail "crash after $1: $crash"
  [ -n "$pid" ] || fail "$pkg is not running after $1"
  echo "alive after $1 (pid $pid)"
}

a install -r "$apk"
a logcat -b all -c

a shell am start -W -n "$pkg/.MainActivity"
sleep 8
alive launch
shot connect

a shell input tap "$field_x" "$field_y"
sleep 2
a shell input text "$address"
sleep 1
shot typed
a shell input tap "$field_x" "$button_y" # → hq_origin + open_hq (Rust)
sleep 20
alive "open $address"
shot hq
pct=$(diff_pct typed hq)
echo "connect → HQ: $pct% of pixels changed"
python3 -c "import sys; sys.exit(0 if float('$pct') >= 20 else 1)" \
  || fail "screen barely changed after submitting $address ($pct%): navigation did not happen"

a shell input keyevent 4 # Back at the HQ root → connect screen
sleep 6
alive back
shot back
pct=$(diff_pct hq back)
echo "HQ → Back: $pct% of pixels changed"
python3 -c "import sys; sys.exit(0 if float('$pct') >= 20 else 1)" \
  || fail "Back did not leave HQ ($pct% changed)"
pct=$(diff_pct connect back)
echo "connect vs back: $pct% differ (recent list added)"

# Switching uimode restarts Google Play services on the google_apis image, and
# the system kills every app using its FontsProvider (the WebView does) with
# "depends on provider … in dying proc" (run 42327173537). Let it settle first.
a shell am force-stop "$pkg"
a shell cmd uimode night yes
sleep 20
timeout 30 adb logcat -d -b all > "$out/logcat-light.txt" 2>&1 || true
a logcat -b all -c
a shell am start -W -n "$pkg/.MainActivity"
sleep 8
alive "dark relaunch"
shot connect-dark
a shell cmd uimode night no

rm -f "$out"/*.raw
timeout 30 adb logcat -d -b all > "$out/logcat.txt" 2>&1 || true
echo "UAT passed"
