name := "nepo-maybe-baby"
version := `python3 -c "import json; print(json.load(open('manifest.json'))['version'])"`
dist := "dist"

# Public - the /detail/ segment of the Chrome Web Store listing URL
chrome_id := "jnnpioocgbkcpokgggkjapihiijegnah"

# List available recipes
default:
    @just --list

# Validate the manifest and confirm every file it references exists
check:
    #!/usr/bin/env python3
    import json, sys
    from pathlib import Path

    manifest = json.loads(Path("manifest.json").read_text())
    referenced = set(manifest.get("icons", {}).values())
    for script in manifest.get("content_scripts", []):
        referenced.update(script.get("js", []))
        referenced.update(script.get("css", []))
    background = manifest.get("background", {})
    referenced.update(background.get("scripts", []))
    if "service_worker" in background:
        referenced.add(background["service_worker"])

    missing = sorted(f for f in referenced if not Path(f).exists())
    for f in missing:
        print(f"missing: {f} (referenced by manifest.json)", file=sys.stderr)
    if missing:
        sys.exit(1)
    print(f"manifest OK - {len(referenced)} referenced files present")

# Run the AMO validator - the same linter addons.mozilla.org runs on submit
lint:
    npx --yes web-ext lint --source-dir . --ignore-files 'dist/**' '.github/**' 'justfile' '.gitignore' 'icons/icon.svg'

# Re-render the icon PNGs from the SVG source
icons:
    for s in 16 32 48 96 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png; done

# Build a store-ready zip in dist/
package: icons check
    @mkdir -p {{dist}}
    rm -f {{dist}}/{{name}}-{{version}}.zip
    zip -r -X -q {{dist}}/{{name}}-{{version}}.zip manifest.json content.js style.css LICENSE icons -x 'icons/*.svg'
    @echo "built {{dist}}/{{name}}-{{version}}.zip"

# web-ext signs from a directory rather than a zip, so the release package is
# unpacked and signed from that: AMO then receives exactly the files that ship,
# instead of whatever an ignore list happens to leave behind in the source tree.
#
# `--approval-timeout 0` returns once AMO accepts the upload. A listed
# submission then waits on human review, which can take days.
#
# Needs WEB_EXT_API_KEY (the JWT issuer) and WEB_EXT_API_SECRET in the
# environment.
[doc("Submit the built package to addons.mozilla.org as a listed release")]
publish-firefox: package
    rm -rf {{dist}}/firefox {{dist}}/web-ext
    mkdir -p {{dist}}/firefox
    unzip -q {{dist}}/{{name}}-{{version}}.zip -d {{dist}}/firefox
    npx --yes web-ext sign --source-dir {{dist}}/firefox --artifacts-dir {{dist}}/web-ext --channel listed --approval-timeout 0

# Upload the built package to the Chrome Web Store and submit it for review
#
# Uses the v2 API, which addresses an item as publishers/<publisher>/items/<item>.
# The two ids are different: the item id is the /detail/ segment of the public
# listing URL, while the publisher id identifies the account and is shown under
# Publisher > Settings in the developer dashboard. Needs
# CHROME_PUBLISHER_ID, CHROME_CLIENT_ID, CHROME_CLIENT_SECRET and
# CHROME_REFRESH_TOKEN in the environment, the last minted against the
# chromewebstore scope.
[doc("Upload the built package to the Chrome Web Store and submit it for review")]
publish-chrome: package
    #!/usr/bin/env python3
    import json, os, sys, time, urllib.error, urllib.parse, urllib.request

    def required(name):
        value = os.environ.get(name)
        if not value:
            sys.exit(f"{name} is not set")
        return value

    def call(url, data=None, headers=None, method="POST"):
        request = urllib.request.Request(url, data=data, method=method)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            sys.exit(f"{method} {url} failed: {error.code} {detail}")
        return json.loads(body) if body else {}

    package = "{{dist}}/{{name}}-{{version}}.zip"
    item = f"publishers/{required('CHROME_PUBLISHER_ID')}/items/{{chrome_id}}"

    # The refresh token is long-lived; this trades it for an hour-long access
    # token, which is the only credential the store API itself accepts.
    token = call(
        "https://oauth2.googleapis.com/token",
        urllib.parse.urlencode({
            "client_id": required("CHROME_CLIENT_ID"),
            "client_secret": required("CHROME_CLIENT_SECRET"),
            "refresh_token": required("CHROME_REFRESH_TOKEN"),
            "grant_type": "refresh_token",
        }).encode(),
        {"Content-Type": "application/x-www-form-urlencoded"},
    )["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    with open(package, "rb") as handle:
        uploaded = call(
            f"https://chromewebstore.googleapis.com/upload/v2/{item}:upload",
            handle.read(),
            auth | {"Content-Type": "application/zip"},
        )

    # The upload usually completes inline, but the API is allowed to return
    # IN_PROGRESS and finish asynchronously. Publishing before it settles is
    # rejected, so wait it out rather than racing it.
    state = uploaded.get("uploadState")
    deadline = time.monotonic() + 300
    while state == "IN_PROGRESS" and time.monotonic() < deadline:
        time.sleep(15)
        status = call(
            f"https://chromewebstore.googleapis.com/v2/{item}:fetchStatus",
            headers=auth,
            method="GET",
        )
        state = status.get("lastAsyncUploadState")

    if state != "SUCCEEDED":
        sys.exit(f"upload ended in state {state}")

    published = call(
        f"https://chromewebstore.googleapis.com/v2/{item}:publish",
        b"{}",
        auth | {"Content-Type": "application/json"},
    )
    print(f"uploaded {package}, item is now {published.get('state')}")

# Remove build output
clean:
    rm -rf {{dist}}
