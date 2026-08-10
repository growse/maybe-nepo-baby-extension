name := "nepo-maybe-baby"
version := `python3 -c "import json; print(json.load(open('manifest.json'))['version'])"`
dist := "dist"

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

# Remove build output
clean:
    rm -rf {{dist}}
