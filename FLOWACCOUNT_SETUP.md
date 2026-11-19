# FlowAccount / EPC in the real te-coin app

Run locally:

    npm run start:flowaccount

Open http://localhost:3003, log in with an existing TeraCoin admin account,
then choose FlowAccount / EPC and fetch receipts. The private API bridge listens
on 127.0.0.1:4319; React forwards /integration requests to it.

The existing .env.local database settings are preserved. .env.flowaccount holds
server-only credentials and is ignored by Git. Never put these in REACT_APP_*.
A supplied access token expires after 24 hours. For automatic token refresh,
provide FLOWACCOUNT_CLIENT_ID and FLOWACCOUNT_CLIENT_SECRET privately.

Database setup: run supabase/FLOWACCOUNT_DATABASE_SETUP.sql against the SAME
TeraCoin project configured in .env.local (enhhollvivkrthygnour). It adds three
RLS-protected mapping/import tables and an admin-only transactional credit RPC.
It does not reset existing formulas, balances, accounts, prices or stock.

The /test API is SANDBOX: the app displays EPC names and calculates a preview,
but both server and SQL prevent real Coin credit from sandbox documents.
Production credit requires a production token, FLOWACCOUNT_ENVIRONMENT=v1,
a stable seller FLOWACCOUNT_ACCOUNT_ID and FLOWACCOUNT_ENABLE_CREDIT=true.
Do not simply relabel sandbox credentials as production.

EPC companies are identified by (seller account, environment, contactId), never
by display name alone. Existing Coin accounts can be explicitly linked; otherwise
an EPC balance account is created atomically on the first production import.
No Auth user or password is automatically generated. An EPC login must be linked
to the relevant company by an administrator before that user can read its balance.

Products are matched by exact normalized model name against stock_profit. Ambiguous
or unknown models and zero costs remain unresolved; they are never assigned another
product's cost. Production import saves the verified mapping server-side.

The Stock Profit tab (gid 1280055382) in spreadsheet
1fKBi2W44MgTpB-ehXa2nocSDIVKJ5lVC9lt5uYsjQW4 supplied 76 catalog price rows.
The price import preserves existing product IDs, inventory quantities and ledger history.
Source metadata is stored in tc_settings.membership_config.product_catalog_source.
This is a one-time price import, not an automatic sheet synchronization.

FlowAccount earning follows the Settings page, independently of legacy reward ASTs:
commission/unit = actual receipt item net unit price × group commission rate;
A = (actual price − selected base cost − commission/unit) × item quantity;
TC = round(max(0, A × group B), 2).
Group overrides fall back to tc_settings.commission and y. The selected base-cost
column falls back to tier_2_price. Existing ledger entries are not recalculated.

Receipts must be status 5 / paid, collected in full, with no remaining amount.
Referenced tax invoices are fetched and checked for matching buyer and full settlement.
Per the requested earning basis, receipt item net amounts determine sales value even
when the header VAT base has a deduction; the difference is shown in the UI.
Unconfirmed discounts and unsupported item identities are held for review.

Imports do not decrement stock (the accounting system already records the sale).
A database unique key and transaction lock prevent repeated receipt/invoice
credits. Changed imported source data raises a reconciliation error, not a silent
balance adjustment. Corrections and cancellations require manual reconciliation.

No automatic polling or periodic job is installed. Use the import page and its
pagination. Before remote deployment, route /integration to the private server,
use HTTPS and configure secrets on the hosting server; the static build alone
does not include a FlowAccount backend.

## EPC registration and company confirmation

Signup collects company name, tax ID (13 digits), branch (5 digits, HQ 00000),
contact phone and login credentials. At 13 digits the private bridge searches
FlowAccount and returns company name, branch, phone and customer code. A unique result fills those
fields; multiple matches require branch selection. No match allows manual entry
for admin review. The signup lookup is exact-tax and rate limited; purchase/financial records and credentials are never returned.

Signup metadata creates only a pending tc_epc_requests record. Admin uses the
Users page to fetch matching FlowAccount contacts and confirm the representative.
The backend re-fetches the selected contact, checks tax/branch and request revision,
then atomically links its contact ID to the authenticated customer's balance account.
Existing customers can submit the same request from their dashboard.

Approved customers read sanitized tc_flow_previews through own-company RLS.
Admin receipt refresh publishes previews for linked companies. Previews do not
change spendable balances or permit Sandbox redemption.

The tax-ID field appears first. Email and password are entered by the EPC; absent contact values remain empty for manual entry. Changing tax ID clears previous company fields and ignores stale responses.

## Admin EPC account lifecycle

Users page supports suspend, resume and delete for customer/EPC accounts only.
Deletion removes the Supabase Auth login and its cascading sessions/identities,
releasing the email for re-registration. Company wallets, receipts, Coin history,
source imports and an account snapshot remain. Auth references from historical
rows are set null rather than deleting the underlying financial rows.
Deletion requires typed company-name confirmation. Suspension can be resumed.
Self-management and managing staff/admin accounts through this endpoint are denied.
Inactive or removed profiles cannot use still-valid JWTs to read application data
or redeem rewards. The frontend also checks account state every 15 seconds.

A fresh registration has a new identity and pending company approval. The admin
must confirm tax/branch again. If the original company wallet has no login owner,
approval reattaches that wallet/history after checking the fresh wallet is empty.
It never transfers a company already owned by another active account.
Deleted account snapshots are shown only when the admin enables the archive filter.

## Sales review refresh

Admin can click **ดึงข้อมูลล่าสุด** on the sales review page. The Node bridge
starts one full tax-invoice sync at a time and serves the previous completed
report until the new report is ready. The same job runs once daily at 03:00
Asia/Bangkok while the bridge is running. It uses read-only FlowAccount API calls.

Production requires a continuously running Node bridge, Python 3 on PATH
(or `FLOWACCOUNT_PYTHON_BIN`), and a writable private persistent filesystem for
the report. Use `FLOWACCOUNT_SALES_REVIEW_PATH` to point at a persistent volume
if needed. Run a single bridge instance for this schedule and proxy
`/integration/flowaccount/` to it from the website. A frontend-only deployment
or an offline bridge cannot run the daily job. A missed run can be triggered
from the Admin page when the bridge is back online.
