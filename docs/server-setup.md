# Server setup for a shared lab server

For the lab's server administrator. Do this once. Without it, Worldline Desktop still works: **Send my saves** sends the data, it just cannot create folders for renamed or new subjects on the server.

## 1. What the script is and why

`server/worldline-ensure-subjects` (in this repository) is a small bash script that runs on the lab server. It is the app's only way to create folders there. When a scientist presses **Send my saves**, the app logs in with the person's SSH key and runs:

```
worldline-ensure-subjects <project-path> <subject>...
```

The script only **adds**:

- A project must be a direct child of the server root (default `/datalad/mri/MRI-Lab_Repository`) and already contain `.git`.
- Subject names must look like `sub-...` (letters, digits, `+ . _ -`, at most 63 characters after `sub-`).
- It creates the missing subject folder (`mkdir` without `-p`), runs `git init` and `git annex init`, and sets `receive.denyCurrentBranch=updateInstead` so a push can arrive.
- A subject that already exists is reported as `exists`. Anything else that is already there is `refused`.
- It never deletes anything, except the single folder it created itself in the same run when one of its own setup steps fails. It never changes permissions or groups.

## 2. Install

```
sudo install -m 0755 -o root -g root server/worldline-ensure-subjects /usr/local/bin/worldline-ensure-subjects
```

If the repository folder is not `/datalad/mri/MRI-Lab_Repository`, set `WORLDLINE_ROOT` for the script (for example in the environment of non-interactive logins) to the right folder.

Check it from a computer, the way the app logs in (no terminal, no profile):

```
ssh <server> 'command -v worldline-ensure-subjects'
```

This must print `/usr/local/bin/worldline-ensure-subjects`. If it prints nothing, the script is not found by non-interactive logins. When we looked (2026-11-21), `git`, `git-annex` and `datalad` were on the path of non-interactive logins on the lab server.

## 3. Protect against deletion and history rewriting

Today nothing on the server stops a push from deleting a branch or rewriting history, and the repository folder has no sticky bit. Two small changes close this:

```
sudo chmod +t /datalad/mri/MRI-Lab_Repository
sudo git config --system receive.denyDeletes true
sudo git config --system receive.denyNonFastForwards true
```

- **`chmod +t` (sticky bit):** in that folder only the owner of a project folder (or root) can delete or rename it. Verify: `ls -ld /datalad/mri/MRI-Lab_Repository` shows a `t` at the end of the permissions (for example `drwxrwsr-t`).
- **`receive.denyDeletes`:** a push cannot delete a branch or tag.
- **`receive.denyNonFastForwards`:** a push cannot overwrite history that is already on the server.

Verify the two git settings: `git config --system --get-regexp '^receive\.deny'` lists both as `true`. They apply to every repository on the server that does not set them differently itself.

## 4. Who sees what

Project folders currently get the group `domain users` and mode `rwxrwx---`, which probably means everyone in that group can read and write them. Who may see or change which project is for the lab to decide later (for example with separate groups per project). The script does not touch permissions: a folder it creates gets the ordinary defaults of the person who runs it.

## 5. Later, not yet recommended: only allow what the app needs

You can restrict the SSH logins of non-administrators so only `git`, `git-annex` and this script can run, using a `Match Group ... ForceCommand` block in `sshd_config` that checks the requested command. **This can lock people out**, including the folder browser and `git-annex` transfers. Do not roll it out until you have tested it with a spare account and a second administrator session that stays logged in. We do not recommend it yet.

## 6. How you know it works

In Worldline Desktop, rename a subject (or add a new one) in a project whose remote is on the lab server and lies under a saved Connection Favorite. Press **Send my saves**. After the push the app lists the subjects it set up on the server. If the script is not installed, the app says so in plain words and the push still runs.

Back to the [researcher workflow](product/researcher-workflow.md).
