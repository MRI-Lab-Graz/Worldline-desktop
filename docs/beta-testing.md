# Beta testing guide (0.6.0-beta.1)

Thank you for testing Worldline Desktop. This is a **beta**: a version that is not finished and has not been used on all systems yet. It is published as a GitHub *pre-release*, so the normal download links do not give it to you; use the links below.

**Please keep a copy of real data.** The app can delete local copies of files (**Free up space**). Try it on a copy or on made-up data first.

## Install

Builds are not code-signed, so use the install script for your system. It checks the app against a SHA-256 written into the script. Release page: <https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/tag/v0.6.0-beta.1>

- **Windows:** download [windows-install.cmd](https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/download/v0.6.0-beta.1/windows-install.cmd) and double-click it.
- **macOS (Apple silicon only):** open Terminal and run

  ```bash
  curl -fsSL https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/download/v0.6.0-beta.1/macos-install.sh | bash
  ```

- **Linux (64-bit Intel/AMD):** open a terminal and run

  ```bash
  curl -fsSL https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/download/v0.6.0-beta.1/linux-install.sh | bash
  ```

To check a download yourself, get `SHA256SUMS.txt` from the same release page and run `sha256sum -c SHA256SUMS.txt --ignore-missing` (macOS: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing`; Windows PowerShell: `Get-FileHash <file>` and compare by eye).

## A 10-minute checklist

Do this on each system you have. Note what surprises you, even small things.

1. **Create a project** with the app (Create Project). Add a text file.
2. **Save** with a short message. Open **History** and find your save.
3. **Branch and merge:** make a branch, change the file, save, switch back, then **Merge** the branch.
4. **Add a remote:** make an empty folder on your computer and add it as a Remote in **Setup**. Answer the question about whether the source accepts changes.
5. **Sync:** on the **Sync** tab try **Send my saves**, then **Get updates**.
6. **BIDS project** (a small one, ideally a copy): open it, go to **Choose data**, tick one subject and `T1w`, download, then **Free up space** on the copy.
7. On macOS or Linux you can also make a ready-made sample project (needs DataLad on the command line): `sh scripts/make-sample-project.sh` from a checkout of the repository. On Windows just use step 1.

## If something breaks

Please send, through [GitHub Issues](https://github.com/MRI-Lab-Graz/Worldline-desktop/issues):

- a screenshot,
- the exact text of the message you saw,
- the output of **Setup, Check Environment**,
- your system (Windows 10/11, macOS version, Linux distribution) and the app version (shown in the header and in Setup).

## Uninstall

- **Windows:** run `uninstall.cmd` in `%LOCALAPPDATA%\Worldline Desktop`.
- **macOS:** `rm -rf "$HOME/Applications/Worldline Desktop.app"`
- **Linux:** delete `~/Applications/Worldline-Desktop.AppImage` and `~/.local/share/applications/worldline-desktop.desktop`.

Your projects are normal folders and stay where they are.
