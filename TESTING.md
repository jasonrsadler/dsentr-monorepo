# Manually Verifying the "Create Google Sheet Row" Workflow Action

Follow these steps to exercise the Google Sheets action end-to-end using the dsentr UI and a real spreadsheet.

> **Security reminder:** Manual verification **must** be performed with disposable or sandbox Google accounts and fully scrubbed test data. Never authenticate with production or customer-owned identities, and never point to sheets that contain live customer data. Review the repository-wide [secret handling policy](SECURITY.md) and broader QA guidance in [`docs/README.md`](docs/README.md) before starting so you understand the mandatory controls around credentials and testing fixtures.

## 0. Create sanitized test assets

1. Provision a new Google account dedicated to testing (e.g., `dsentr-sheets-e2e+<date>@example.com`) or reuse an approved sandbox identity.
2. Create a new Google Sheet owned by that account. Do **not** reuse any sheet that contains or once contained production data.
3. Populate the sheet with synthetic headers and sample rows that mimic the required schema while remaining free of customer-identifiable information.
4. If you need to share the sheet with teammates, restrict access to the smallest group necessary and clearly label it as **Test Data Only**.
5. Document the sheet URL in your test notes to aid post-run cleanup.

## 1. Prepare Google resources

1. Using the sanitized sheet prepared above, confirm you retain edit permissions.
2. Copy the spreadsheet ID from the Sheet URL. It is the value between `/d/` and `/edit` (for example, `1AbCDefGhIj...`).
3. Inside the Sheet, create or confirm the name of the worksheet tab you want to write to (e.g., `Sheet1`). The name is case-sensitive.
4. Make note of the column letters (A, B, C, …) that correspond to the cells you want to populate. Column mappings must use these letters rather than header text.

## 2. Connect Google to dsentr

1. In dsentr, navigate to **Settings → Integrations**.
2. Under Google, click **Connect** (or **Reconnect** if needed).
3. When prompted, sign in with the Google account that owns the Sheet.
4. Approve the requested permissions, including access to Google Sheets.
5. After the redirect back to dsentr, verify the integration shows as **Connected** and displays the account email.

## 3. Configure the workflow action

1. Open or create a workflow that uses the **Create Google Sheet Row** action node.
2. In the action configuration panel, fill in the fields:
   - **Google account dropdown**: select the connected Google account email you authorized above. If the dropdown is empty, return to the integrations page to connect an account.
   - **Spreadsheet ID**: paste the ID you copied from the Sheet URL.
   - **Worksheet Name**: enter the worksheet/tab name exactly as it appears in the Sheet (e.g., `Sheet1`).
   - **Column Mappings**: add a row for each column/value pair you want to insert. Enter the sheet column letter under **Column** (e.g., `A`, `B`, `AA`) and the value or templated expression under **Value** (e.g., `{{trigger.first_name}}`). Use one mapping per row and avoid duplicate column letters.
3. Ensure there are no validation errors shown beneath the inputs. If errors appear, correct the values before proceeding.

## 4. Run the workflow

1. Trigger the workflow using your preferred method (manual run, test payload, or connected trigger).
2. Monitor the run status until it completes. If it fails, inspect the error message on the run detail page.
3. Open the target Google Sheet and confirm a new row has been appended with the values you configured.

## 5. Troubleshooting tips

- A `403` or "insufficient permissions" error indicates the connected Google account did not grant the Sheets scope. Reconnect the Google integration and ensure you approve the Sheets permission prompt.
- If the row is added to the wrong worksheet, double-check the worksheet name for typos or trailing spaces.
- When using templated values, use the preview context to confirm the rendered output before executing the workflow.
- Validation errors such as "column exceeds the Google Sheets column limit" or "duplicate column" indicate the **Column** field needs attention. Ensure the key is a literal column letter (A–ZZZ) with no template syntax and that each letter is used only once.

## 6. Post-test cleanup

1. Remove any rows created during testing or archive the sheet if it is no longer needed.
2. Revoke access that was temporarily granted to collaborators or service accounts.
3. Log disposal of test data in your QA notes to demonstrate compliance with our data-handling requirements.
4. If any secrets or accounts were rotated for the exercise, update the relevant records following the procedures in [SECURITY.md](SECURITY.md).
