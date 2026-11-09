#!/bin/bash
# Installs Worldline Desktop for the current user (Apple silicon). No administrator rights needed for this script.
#
# Run it with:   curl -fsSL https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/latest/download/macos-install.sh | bash
# or download it and run:   bash macos-install.sh
# The copy attached to a GitHub release has the version and the SHA-256 of that release's app zip filled in by CI.
# The copy in the repository is a template: it runs the macos-install.sh of the latest release instead.
#
# Options:
#   --from-dir <folder>   take the zip from that folder (named as on the release page) instead of downloading it;
#                         its SHA-256 is still checked

# Everything lives in main, called on the last line: with `curl | bash` the shell reads this file from stdin, so it has
# to be parsed completely before any command that might read stdin runs.
main() {
    set -euo pipefail

    # ---- Pins ----
    local APP_VERSION='__VERSION__'
    local APP_ZIP_SHA256='__ZIP_SHA256__'
    local REPO='MRI-Lab-Graz/Worldline-desktop'
    local APP_ZIP_NAME="Worldline-Desktop-${APP_VERSION}-mac-arm64.zip"
    local APP_ZIP_URL="https://github.com/${REPO}/releases/download/v${APP_VERSION}/${APP_ZIP_NAME}"
    local APP_NAME='Worldline Desktop.app'
    local APP_DIR="$HOME/Applications"
    local LOG_DIR="$HOME/Library/Logs/Worldline Desktop"
    local DATA_DIR="$HOME/Library/Application Support/Worldline Desktop"   # the app's own data folder; it looks for datalad-env here
    local from_dir=''

    die() { echo "ERROR: $*" >&2; exit 1; }
    log() { echo "==> $*"; }

    case "$APP_VERSION" in
        __*) # repository template: hand over to the latest release's copy, which has the version and hash filled in
            log 'Repository template: running the macos-install.sh of the latest release'
            curl -fsSL "https://github.com/${REPO}/releases/latest/download/macos-install.sh" | bash -s -- "$@" ||
                die 'Could not run the macos-install.sh of the latest release.'
            exit 0 ;;
    esac
    while [ $# -gt 0 ]; do
        case "$1" in
            --from-dir) [ $# -ge 2 ] || die '--from-dir needs a folder'; from_dir="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] ||
        die 'This installer supports Macs with Apple silicon only. Intel Macs are not supported.'

    mkdir -p "$LOG_DIR"
    exec > >(tee -a "$LOG_DIR/install.log") 2>&1
    log "Worldline Desktop $APP_VERSION"

    check_hash() {
        local actual
        actual=$(shasum -a 256 "$1" | awk '{print toupper($1)}')
        [ "$actual" = "$APP_ZIP_SHA256" ] || die "SHA-256 of $(basename "$1") does not match this release ($actual). Nothing was installed."
    }

    install_app() {
        local target="$APP_DIR/$APP_NAME" old="$APP_DIR/$APP_NAME.old" work zip
        mkdir -p "$APP_DIR"
        work=$(mktemp -d "$APP_DIR/.install.XXXXXX")
        trap "rm -rf '$work'" EXIT   # expanded now: $work is local and gone when the trap fires
        if [ -n "$from_dir" ]; then
            zip="$from_dir/$APP_ZIP_NAME"
            [ -f "$zip" ] || die "$zip not found"
        else
            zip="$work/$APP_ZIP_NAME"
            log "Downloading $APP_ZIP_URL"
            curl -fsSL --retry 3 -o "$zip" "$APP_ZIP_URL" || die "Download failed: $APP_ZIP_URL"
        fi
        check_hash "$zip"
        ditto -x -k "$zip" "$work/x"
        [ -d "$work/x/$APP_NAME" ] || die "The zip has no $APP_NAME at its root."
        if pgrep -f "$APP_NAME/Contents/MacOS" >/dev/null 2>&1; then
            die 'Worldline Desktop is running. Quit it and run this installer again.'
        fi
        if [ -e "$target" ]; then
            rm -rf "$old"
            mv "$target" "$old"
        fi
        mv "$work/x/$APP_NAME" "$target"
        if ! codesign --verify --deep --strict "$target"; then
            rm -rf "$target"
            if [ -e "$old" ]; then mv "$old" "$target"; fi
            die 'The new app failed codesign verification; the previous install was restored.'
        fi
        rm -rf "$old"
        xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
        log "Installed $target"
    }

    # The git-annex build we pin (a PyPI wheel) needs macOS 15. Checked before anything is installed.
    check_macos() {
        local major
        major=$(sw_vers -productVersion | cut -d. -f1)
        [ "$major" -ge 15 ] 2>/dev/null ||
            die "This version needs macOS 15 or newer (you have $(sw_vers -productVersion)). Nothing was installed."
    }

    # Python, DataLad and git-annex go into a private environment next to the app's data, from hash-locked packages,
    # installed with the uv that ships inside the app. Nothing from the system Python or another package manager is used.
    install_env() {
        local res="$APP_DIR/$APP_NAME/Contents/Resources"
        local uv="$res/uv/uv" req="$res/datalad-requirements-macos.txt" venv="$DATA_DIR/datalad-env"
        [ -x "$uv" ] && [ -f "$req" ] || die "The app is missing its installer files ($uv, $req)."
        mkdir -p "$DATA_DIR"
        export UV_PYTHON_INSTALL_DIR="$DATA_DIR/python"
        UV_CACHE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/dlad-uv-cache.XXXXXX")
        export UV_CACHE_DIR
        log 'Installing Python, DataLad and git-annex (needs internet; every package is checked against a hash)'
        "$uv" venv --clear --no-config --managed-python --python 3.12 "$venv" </dev/null ||
            die 'Could not create the DataLad environment.'
        "$uv" pip install --no-config --python "$venv" --link-mode copy --index-url https://pypi.org/simple \
            --require-hashes --only-binary :all: --no-deps -r "$req" </dev/null ||
            die 'Could not install DataLad and git-annex.'
        rm -rf "$UV_CACHE_DIR"
        "$venv/bin/datalad" --version || die 'DataLad was installed but "datalad --version" does not run.'
        "$venv/bin/git-annex" version | head -1 || die 'git-annex was installed but does not run.'
    }

    check_macos
    install_app
    git --version >/dev/null 2>&1 || die 'git is missing. Run  xcode-select --install  and run this installer again.'
    install_env

    log "Done. Open $APP_DIR/$APP_NAME. Log: $LOG_DIR/install.log"
}

main "$@"
