# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `ynab_categories_write` `auto_assign` action with optional `dry_run` (default true; writes only when explicitly false) and `max_total` (dollars). Fills underfunded goals from Ready to Assign, biggest gap first, never exceeding `max_total` or Ready to Assign.

- `ynab_transactions_read` actions `spending_by_category`, `spending_by_payee` and `cash_flow`, plus an optional `months` parameter for `cash_flow`. They reuse `since_date`, `until_date` and `limit`, count split transactions by leg and leave transfers out.

### Changed
- `ynab_categories_write` `move` now writes the two categories one after the other and, if the second write fails, reports which category was already changed.
- Upgraded the `ynab` SDK from 4.0.0 to 4.5.0.
- `ynab_accounts_write` `create` now returns a clear error listing the 6 types the YNAB API can create (checking, savings, cash, creditCard, otherAsset, otherLiability) when another type is passed. The `type` enum still lists all 13 values, and the `ynab_accounts` read filter keeps all 13.

### Fixed
- YNAB API errors (plain objects thrown by the SDK) now show YNAB's own message, for example `Error: account_id is invalid (400 bad_request)`, instead of `Error: [object Object]`.

## [0.1.2] - 2024-03-26

### Added
- New `ApproveTransaction` tool for approving existing transactions in YNAB
  - Can approve/unapprove transactions by ID
  - Works in conjunction with GetUnapprovedTransactions tool
  - Preserves existing transaction data when updating approval status
- Added Cursor rules for YNAB API development
  - New `.cursor/rules/ynabapi.mdc` file
  - Provides guidance for working with YNAB types and API endpoints
  - Helps maintain consistency in tool development

### Changed
- Updated project structure documentation to include `.cursor/rules` directory
- Enhanced README with documentation for the new ApproveTransaction tool 