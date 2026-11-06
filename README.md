# Organisation folders

This script creates a Drive folder for a Capsule organisation in the Bite Engineering shared Drive folder. It then writes the folder ID, the folder link and the status back onto the same Capsule record.

An organisation gets a folder when either of these is true:

- its **Drive provisioning** field is set to **Ready**, or
- it is tagged **Design Partner**, its **Drive provisioning** is empty, and it has no folder yet.

The script runs every five minutes. An organisation set to **Ready** or tagged **Design Partner** is picked up on the next run, not the moment you change it. You do not need to open Apps Script for a normal organisation.

Contract files are not created. Account briefs are not created either: the prospect research skill makes each brief from `Template - Account Brief` when it researches a person. Nobody outside Bite is added to the folder, including `05 — Files Shared Externally`.

## What you do in Capsule

On the organisation, either set **Drive provisioning** to **Ready** or add the **Design Partner** tag. Leave **Drive folder ID** empty.

To stop a tagged organisation from getting a folder, set **Drive provisioning** to **Not ready**.

The tags that create a folder are set in `triggerTags` in [`Config.js`](appsscript/Config.js).

| Drive provisioning | Meaning |
| --- | --- |
| (empty) | Nothing happens, unless the organisation has a trigger tag. Then it counts as Ready. |
| Not ready | Nothing happens, even if the organisation is tagged. |
| Ready | The next run creates the folder. |
| In progress | A run started and has not finished. The next run continues the same folder. |
| Provisioned | The folder exists. **Drive folder URL** opens it. |
| Error | Read the note the script added to the organisation, fix the cause, then set **Drive provisioning** back to **Ready**. |

These custom fields must exist on organisations in Capsule (**Settings → Custom fields**):

| Field | Type | What it is for |
| --- | --- | --- |
| Drive provisioning | List | Not ready, Ready, In progress, Provisioned, Error |
| Drive folder ID | Text | Written by the script. |
| Drive folder URL | Text or link | Written by the script. |

The organisation's name is used as the folder name. If a field is missing, the run stops and the execution log names it.

## What you get in Drive

Each organisation gets one folder. Inside it:

- `01 — Commercial`
  - `01 — Proposals & Pricing`
  - `02 — Contracts`
  - `03 — Purchase Orders & Billing`
- `02 — Correspondence & Meetings`
- `03 — Data In`
- `04 — Delivery & Feedback`
- `05 — Files Shared Externally`
- `99 — Archive`

The organisation folder is created inside this folder:

https://drive.google.com/drive/u/2/folders/1QKoEAbzBXleNuhZz2vAwZeDFzrttdKc0

People who can already open that shared folder can open the new organisation folder. The script does not send any new share.

Each folder stores its Capsule record ID in Drive (`capsulePartyId`). That is how the script finds the folder again, so:

- Setting **Ready** again after **Provisioned** does not create a second folder.
- Renaming the organisation in Capsule does not rename the Drive folder or create a new one. The folder keeps the name it was given when it was created.

If a folder with the same name already exists in that parent folder and is not linked to this record, the organisation goes to **Error** and the script creates nothing. Folders made by hand, and folders made by the old Notion version of this script, are not linked to any Capsule record.

## When an organisation shows Error

The script adds a note to the organisation that starts with "Drive folder could not be created". Fix what it describes, then set **Drive provisioning** back to **Ready**.

- A folder with that name already exists: rename or remove the unlinked folder, then set **Ready** again.
- The Drive folder ID points at the wrong folder: clear **Drive folder ID**, then set **Ready** again.

If a run stops halfway, for example on a Drive timeout, the organisation stays **In progress** and the next run finishes the same folder. This kind of failure is written to the execution log, not to a note.

One failed organisation does not stop the others.

## Rebuild an organisation folder

Do this only when you want a new folder. Files in the old folder are deleted with it.

1. Delete the organisation folder in Drive.
2. In Capsule, clear **Drive folder ID** and **Drive folder URL**.
3. Set **Drive provisioning** to **Ready**.

If the folder ID is still filled in, **Ready** does nothing.

## Change the folder template

Edit `subfolders` in [`Config.js`](appsscript/Config.js). A `children` list is created inside that folder. The other names are created directly in the organisation folder. From the `crm-setup` folder:

```bash
clasp push
```

Organisations that are already **Provisioned** keep their existing folders. Only a rebuild, after the push, uses the new template.

## Keep the script running

The Apps Script project is owned by a Bite Google account that can open the shared folder. Do not put the Capsule token in git.

In the Apps Script editor, **Project Settings → Script properties**:

| Property | Value |
| --- | --- |
| `ENVIRONMENT` | `sandbox` |
| `CAPSULE_TOKEN` | A Capsule API token (**My preferences → API authentication tokens**) |
| `PARENT_FOLDER_ID` | `1QKoEAbzBXleNuhZz2vAwZeDFzrttdKc0` |

`ENVIRONMENT` must stay `sandbox`. With any other value, or with `CAPSULE_TOKEN` empty, the script returns without doing anything. `SHARED_DRIVE_ID` is only for a real Shared drive whose ID starts with `0A`. Leave it empty for this shared folder.

The trigger is **Triggers → provisionReadyOrganisations → every five minutes**. It runs as the account that installed it, so that account must be able to create folders in the parent folder above.

To see which organisations the next run would pick up, without changing Drive or Capsule, run `previewCandidates` and read the execution log.

To publish a code change, from `crm-setup`:

```bash
clasp push
clasp open-script
```

`clasp open` is not a command in the current clasp. Use `clasp open-script`.

If the execution log says `Drive is not defined`, the Drive advanced service is missing. [`appsscript.json`](appsscript/appsscript.json) turns on Drive API v3. Push that file, then run `provisionReadyOrganisations` once and allow Drive access. See [Advanced Drive Service](https://developers.google.com/apps-script/advanced/drive).

Checks that do not call Capsule or Drive:

```bash
node --test test/validate.test.js
```
