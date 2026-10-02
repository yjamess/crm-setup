# Company folders

When someone sets **Drive provisioning** to **Ready** on a Companies page in Notion, this script creates that company's folder in the Bite Engineering shared Drive folder. It then writes the Drive link back onto the same Notion page.

The script runs every five minutes. A row set to **Ready** is picked up on the next run, not the moment you change it. You do not need to open Apps Script for a normal company.

Contract files are not created. Nobody outside Bite is added to the folder, including `05 — Files Shared Externally`.

## What you do in Notion

On the company page, set **Drive provisioning** to **Ready**. Leave **Drive folder ID** empty.

The company needs a **Company Name**. If that name is missing, the row changes to **Error**, **Drive error** explains why, and no folder is created.

| Drive provisioning | Meaning |
| --- | --- |
| Not ready | Nothing happens. |
| Ready | The next run creates the folder. |
| In progress | A run started and has not finished. The next run continues the same folder. |
| Provisioned | The folder exists. **Drive folder URL** opens it. |
| Error | Read **Drive error**, fix the cause, then set the row back to **Ready**. |

These properties must stay on the Companies database:

| Property | Type | What it is for |
| --- | --- | --- |
| Company Name | Title | The Drive folder is given this name. |
| Drive provisioning | Select | Not ready, Ready, In progress, Provisioned, Error |
| Drive folder ID | Text | Written by the script. |
| Drive folder URL | URL | Written by the script. |
| Drive provisioned at | Date | Written by the script. |
| Drive error | Text | Written by the script when a person needs to act. |

## What you get in Drive

Each company gets one folder. Inside it:

- `01 — Commercial`
  - `01 — Proposals & Pricing`
  - `02 — Contracts`
  - `03 — Purchase Orders & Billing`
- `02 — Correspondence & Meetings`
- `03 — Data In`
- `04 — Delivery & Feedback`
- `05 — Files Shared Externally`
- `99 — Archive`

The company folder is created inside this folder:

https://drive.google.com/drive/u/2/folders/1QKoEAbzBXleNuhZz2vAwZeDFzrttdKc0

People who can already open that shared folder can open the new company folder. The script does not send any new share.

Setting **Ready** again after **Provisioned** does not create a second folder. Renaming the company in Notion does not rename the Drive folder. The folder keeps the name it was given when it was created.

If someone has already made a folder with the same company name in that parent folder, and it is not linked to this Notion page, the row goes to **Error** and the script creates nothing.

## When a row shows Error

Fix what **Drive error** describes, then set **Drive provisioning** back to **Ready**.

- Missing company name: fill **Company Name**.
- A folder with that name already exists: rename or remove the unlinked folder, then set **Ready** again.
- The run stopped halfway: leave the row as **In progress**. The next run finishes that same folder.

One failed company does not stop the others.

## Rebuild a company folder

Do this only when you want a new folder. Files in the old folder are deleted with it.

1. Delete the company folder in Drive.
2. On the Notion page, clear **Drive folder ID** and **Drive folder URL**.
3. Set **Drive provisioning** to **Ready**.

If the folder ID is still filled in, **Ready** does nothing.

## Change the folder template

Edit `subfolders` in [`Config.js`](Config.js). A `children` list is created inside that folder. The other names are created directly in the company folder. From the `crm-setup` folder:

```bash
clasp push
```

Companies that are already **Provisioned** keep their existing folders. Only a rebuild, after the push, uses the new template.

## Keep the script running

The Apps Script project is owned by a Bite Google account that can open the shared folder. The Notion token belongs to a workspace integration, not to one person's login. Do not put that token in git.

In the Apps Script editor, **Project Settings → Script properties**:

| Property | Value |
| --- | --- |
| `ENVIRONMENT` | `sandbox` |
| `NOTION_TOKEN` | Internal integration token |
| `NOTION_DATA_SOURCE_ID` | Printed by `logDataSourceIds` |
| `PARENT_FOLDER_ID` | `1QKoEAbzBXleNuhZz2vAwZeDFzrttdKc0` |
| `NOTION_DATABASE_ID` | Only used by `logDataSourceIds` |

`ENVIRONMENT` must stay `sandbox`. Any other value makes the script return without creating folders. `SHARED_DRIVE_ID` is only for a real Shared drive whose ID starts with `0A`. Leave it empty for this shared folder.

The trigger is already installed: **Triggers → provisionReadyOrganisations → every five minutes**. It runs as the account that installed it, so that account must be able to create folders in the parent folder above.

To publish a code change, from `crm-setup`:

```bash
clasp push
clasp open-script
```

`clasp open` is not a command in the current clasp. Use `clasp open-script`.

If the execution log says `Drive is not defined`, the Drive advanced service is missing. [`appsscript.json`](appsscript.json) turns on Drive API v3. Push that file, then run `provisionReadyOrganisations` once and allow Drive access. See [Advanced Drive Service](https://developers.google.com/apps-script/advanced/drive).

`logDataSourceIds` is only for finding `NOTION_DATA_SOURCE_ID`. Set `NOTION_TOKEN` and `NOTION_DATABASE_ID`, run that function, and copy the printed ID. The database ID in a Notion URL is not always the data source ID. See [Retrieve a database](https://developers.notion.com/reference/retrieve-a-database).

Checks that do not call Notion or Drive:

```bash
node --test test/validate.test.js
```
