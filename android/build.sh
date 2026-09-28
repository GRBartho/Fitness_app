#!/usr/bin/env bash
# Builds dist/LevelUp.apk from the web app without the Android SDK.
# Needs: java 17+, node 18+, python3, curl. Tools are downloaded into android/.tools.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=..
T=.tools
B=.build
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}
mkdir -p "$T"

# --- tools ---
if [ ! -x "$T/aapt2" ]; then
  curl -sL https://registry.npmjs.org/aaptjs3/-/aaptjs3-2.0.2.tgz | tar xz -C "$T"
  cp "$T/package/bin/x64/linux/aapt2" "$T/aapt2" && chmod +x "$T/aapt2" && rm -rf "$T/package"
fi
[ -f "$T/android.jar" ] || curl -sL -o "$T/android.jar" \
  https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar
[ -f "$T/dx.jar" ] || curl -sL -o "$T/dx.jar" \
  https://repo1.maven.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar
[ -d "$T/node_modules/apk_sign_ts" ] || (cd "$T" && npm init -y >/dev/null && npm i --silent apk_sign_ts@1.0.1)

rm -rf "$B" && mkdir -p "$B/res" "$B/assets/www" "$B/gen" "$B/classes"

# --- resources (launcher icon from the web icon) ---
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do mkdir -p "$B/res/mipmap-${d%%:*}"; done
cp -r res/values "$B/res/"
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do cp "$ROOT/icons/icon-192.png" "$B/res/mipmap-$d/ic_launcher.png"; done

# --- web assets ---
cp "$ROOT"/{index.html,styles.css,data.js,app.js,manifest.webmanifest} "$B/assets/www/"
cp -r "$ROOT/icons" "$B/assets/www/"

# --- compile & link ---
"$T/aapt2" compile --dir "$B/res" -o "$B/res.zip"
"$T/aapt2" link -I "$T/android.jar" --manifest AndroidManifest.xml -A "$B/assets" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$B/gen" -o "$B/base.apk" "$B/res.zip"

javac -nowarn --release 8 -cp "$T/android.jar" -d "$B/classes" \
  $(find src "$B/gen" -name '*.java') 2>&1 | grep -v 'warning' || true
java -cp "$T/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"

# --- package (4-byte aligned, as Android requires for targetSdk 30+) ---
python3 zipalign.py "$B/base.apk" "$B/classes.dex" "$B/unsigned.apk"

# --- sign ---
mkdir -p "$ROOT/dist"
node sign.mjs "$B/unsigned.apk" "$ROOT/dist/LevelUp.apk"
echo "Built $(cd "$ROOT/dist" && pwd)/LevelUp.apk"
