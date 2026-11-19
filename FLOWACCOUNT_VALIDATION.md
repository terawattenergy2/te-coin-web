# FlowAccount integration validation — 2026-11-06

- Production build passed.
- 32 receipt / existing Coin / formula unit tests passed.
- Isolated PostgreSQL tests passed: receipt-price formula and group override parity; duplicate import idempotency;
  no stock deductions; same-name EPC companies remain separate; changed source held;
  sandbox and unpaid data rejected; failed imports roll back; customer RLS isolation;
  admin-only credit.
- Actual sandbox data: 5 receipts read. Om RE2026110002 now uses its line totals
  (VAT-base difference 40,000 shown); its known SigenStor EC 10.0 TP line yields
  13,912.50 TC. Care's EC 10.0 SP ×10 yields 73,270 TC. Missing catalog products
  remain unresolved. Awaiting-payment and unsupported item records stay held.
- Imported/verified 76 Stock Profit price rows; 76/76 prices match the sheet and
  76/76 existing stock quantities are unchanged. Four zero-cost models are held.
- Both frontend preview and database credit use sale-based commission and group B.
- Installed tc_flow_epcs, tc_flow_product_map, tc_flow_imports and credit RPC on
  TeraCoin project enhhollvivkrthygnour. All new tables have RLS enabled.
- Verified anon cannot execute credit RPC; import count is 0. No actual Coin credit.
- Existing frontend Supabase configuration and stored Coin formulas preserved.
- Local frontend HTTP 200; unauthenticated API/proxy requests HTTP 401.
- Server-only FlowAccount token is absent from the browser build.
- Authenticated browser login, and a production import remain to be
  tested by the operator; no production FlowAccount credentials were supplied.

## Existing database advisories

The security advisor reports existing public SECURITY DEFINER RPCs and disabled
leaked-password protection. No newly added integration object was named in the report.
These existing settings were left unchanged to preserve application behavior.

- RPC guidance: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Password protection: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Rollback files

Application files were backed up before editing at:
/Users/missingtea/.codex/.chatgpt-projects/g-p-6ad5a21eadb08191b1e75650ad734b86/backups/te-coin-before-flowaccount-20261106-151437

No Git commit, push, remote deployment or scheduled import was performed.

## EPC registration validation

- 40 frontend/unit checks passed, including tax lookup, multi-branch selection,
  stale-response cancellation and exact matching. Production build passed.
- PostgreSQL tests: metadata cannot self-approve; only own request is visible;
  tax mismatch/stale approval rejected; customer cannot approve; duplicate company
  linkage blocked; anonymous approval denied. Preview company isolation passed.
- Live HTTP: Om tax ID returns only company name and HQ branch. Admin receipts
  and company approval endpoints still require authentication.
- Browser signup verified: entering Om tax ID filled company name and branch.
- Previously registered Om account was explicitly linked to Sandbox contact
  1414438 following the owner's confirmation, with 13,912.50 TC preview.
  Spendable balance and production ledger were unchanged.

## EPC lifecycle checks

45 frontend/unit tests passed and isolated PostgreSQL lifecycle tests passed:
admin-only actions, self protection, stale transition rejection, suspension
blocks existing-token reads/catalog/redemption, resume restores access, typed
confirmation, terminal archived deletion, history retention and audit isolation.
Verified production accounts remain active and no lifecycle action was performed
on an actual user. Twelve data tables enforce the active-account restriction.
Security advisor reports no newly introduced lifecycle findings.

## Same-email re-registration and button design update

- Isolated PostgreSQL tests passed: login/session removal, preserved company wallet
  and ledger, old JWT denied, same-email re-registration, pending identity isolation,
  and admin re-approval restores the original company history without duplicates.
- Live transactional rollback check passed: a disposable login was removed, the
  same email inserted again, and the original wallet retained. The transaction was
  rolled back; no test identities or changes to real accounts were retained.
- Four frontend test suites (16 tests) and production build passed.
- Browser verified outlined amber/red buttons, inline archive toggle, status badges,
  and a centered portal dialog in the demo workspace. No real account was deleted.

## Compact registration and success state

Registration now uses two states within the same card: tax/company lookup, then
focused email/password fields with a collapsed company summary. Email remains
manual. Successful signup replaces the left artwork with a checkmark and a
confirmation message; email-confirmation and immediately-active signup responses
are handled separately. No test registration email was sent.

13 focused UI tests passed and production build passed. Browser verified a real
Om lookup advances focus to email, with both credential fields and submit button
visible at 1280x720 (document height equals viewport height: 720px).
