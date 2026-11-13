#!/bin/bash
# Installs Worldline Desktop for the current user (Linux, 64-bit Intel/AMD). No administrator rights needed.
#
# Run it with:   curl -fsSL https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/latest/download/linux-install.sh | bash
# or download it and run:   bash linux-install.sh
# The copy attached to a GitHub release has the version and the SHA-256 of that release's AppImage filled in by CI.
# The copy in the repository is a template: it runs the linux-install.sh of the latest release instead.
#
# It does not install git, git-annex or DataLad: that needs your package manager (and sudo), so it only tells you the
# command. Options:
#   --from-dir <folder>   take the AppImage from that folder (named as on the release page) instead of downloading it;
#                         its SHA-256 is still checked

# Everything lives in main, called on the last line: with `curl | bash` the shell reads this file from stdin, so it has
# to be parsed completely before any command that might read stdin runs.
main() {
    set -euo pipefail

    # ---- Pins ----
    local APP_VERSION='__VERSION__'
    local APP_SHA256='__ZIP_SHA256__'
    local REPO='MRI-Lab-Graz/Worldline-desktop'
    local APP_FILE="Worldline-Desktop-${APP_VERSION}.AppImage"
    local APP_URL="https://github.com/${REPO}/releases/download/v${APP_VERSION}/${APP_FILE}"
    local APP_DIR="$HOME/Applications"
    local TARGET="$APP_DIR/Worldline-Desktop.AppImage"
    local MENU_DIR="$HOME/.local/share/applications"
    local ICON_DIR="$HOME/.local/share/icons"
    local from_dir=''
    local exec_line='' no_fuse=''

    die() { echo "ERROR: $*" >&2; exit 1; }
    log() { echo "==> $*"; }

    case "$APP_VERSION" in
        __*) # repository template: hand over to the latest release's copy, which has the version and hash filled in
            log 'Repository template: running the linux-install.sh of the latest release'
            curl -fsSL "https://github.com/${REPO}/releases/latest/download/linux-install.sh" | bash -s -- "$@" ||
                die 'Could not run the linux-install.sh of the latest release.'
            exit 0 ;;
    esac
    while [ $# -gt 0 ]; do
        case "$1" in
            --from-dir) [ $# -ge 2 ] || die '--from-dir needs a folder'; from_dir="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] ||
        die 'This installer supports Linux on a 64-bit Intel/AMD computer only.'

    log "Worldline Desktop $APP_VERSION"

    hash_of() {
        if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print toupper($1)}'
        else shasum -a 256 "$1" | awk '{print toupper($1)}'; fi
    }
    check_hash() {
        local actual
        actual=$(hash_of "$1")
        [ "$actual" = "$APP_SHA256" ] || die "SHA-256 of $(basename "$1") does not match this release ($actual). Nothing was installed."
    }

    install_app() {
        local work image png size
        mkdir -p "$APP_DIR" "$MENU_DIR"
        work=$(mktemp -d "$APP_DIR/.install.XXXXXX")
        trap "rm -rf '$work'" EXIT   # expanded now: $work is local and gone when the trap fires
        if [ -n "$from_dir" ]; then
            image="$from_dir/$APP_FILE"
            [ -f "$image" ] || die "$image not found"
        else
            image="$work/$APP_FILE"
            log "Downloading $APP_URL"
            curl -fsSL --retry 3 -o "$image" "$APP_URL" || die "Download failed: $APP_URL"
        fi
        cp "$image" "$work/new.AppImage"   # the copy is checked, so the file cannot change after the check
        check_hash "$work/new.AppImage"
        chmod +x "$work/new.AppImage"
        # The icons come out of the checked AppImage (extracting needs no FUSE); without them the menu shows a generic icon.
        (cd "$work" && ./new.AppImage --appimage-extract 'usr/share/icons/hicolor/*/apps/*.png' >/dev/null 2>&1) || true
        for png in "$work"/squashfs-root/usr/share/icons/hicolor/*/apps/*.png; do
            [ -f "$png" ] || continue
            size=$(basename "$(dirname "$(dirname "$png")")")
            mkdir -p "$ICON_DIR/hicolor/$size/apps"
            cp "$png" "$ICON_DIR/hicolor/$size/apps/worldline-desktop.png"
        done
        mv -f "$work/new.AppImage" "$TARGET"
        # AppImages need libfuse.so.2. Fedora ships only fuse3, so without it the app runs by unpacking itself on each start.
        if (PATH="$PATH:/sbin:/usr/sbin"; ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'); then
            exec_line="Exec=\"$TARGET\""
        else
            exec_line="Exec=env APPIMAGE_EXTRACT_AND_RUN=1 \"$TARGET\""
            no_fuse=1
        fi
        cat > "$MENU_DIR/worldline-desktop.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Worldline Desktop
Comment=Version control for your research data
$exec_line
Icon=worldline-desktop
Terminal=false
Categories=Science;Utility;
DESKTOP
        log "Installed $TARGET (it is also in your application menu)"
    }

    install_app

    local missing=''
    command -v git >/dev/null 2>&1 || missing="$missing git"
    command -v git-annex >/dev/null 2>&1 || missing="$missing git-annex"
    command -v datalad >/dev/null 2>&1 || missing="$missing datalad"
    if [ -n "$missing" ]; then
        log "Still missing:$missing. Install them with your package manager, for example:"
        echo '  Debian / Ubuntu:  sudo apt install git git-annex datalad'
        echo '  Fedora:           sudo dnf install git git-annex datalad'
        echo '  Any distribution: Homebrew (brew install git-annex datalad) or pipx install datalad'
    fi
    [ -z "$no_fuse" ] ||
        log 'FUSE 2 is not installed, so the app starts a little slower (it unpacks itself each time). To fix: sudo dnf install fuse-libs (Fedora) or sudo apt install libfuse2 (Debian / Ubuntu).'
    log "Done. Start Worldline Desktop from your application menu or run $TARGET"
}

main "$@"
