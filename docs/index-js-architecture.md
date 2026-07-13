# Employee index JavaScript architecture audit

## Scope and constraints

This audit describes the JavaScript loaded by the employee `index.html` from the
customer-management redesign baseline `82193e02732282aa6c5cf09686bf20cbc5882240`.
The redesign changes customer list presentation, filtering, pagination, and detail
navigation without changing customer documents or introducing a migration. The
machine-readable source of truth is
[`index-js-architecture.json`](./index-js-architecture.json).

The files are classic deferred scripts rather than ES modules. Their top-level
function declarations and lexical state therefore form a shared global runtime.
The current order is part of the application contract.

## Inventory

| Order | File | Lines | Bytes (LF) | Functions | Async | Primary responsibility |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `auth-core.js` | 795 | 26,589 | 25 | 13 | Authentication, shared customer state, customer CRUD |
| 2 | `delivery-transaction.js` | 78 | 2,962 | 3 | Atomic delivery state transitions |
| 3 | `imweb.js` | 846 | 34,398 | 47 | Imweb integration, spreadsheet import, legacy completion handlers |
| 4 | `schedule-report.js` | 371 | 17,010 | 37 | Date/schedule/report calculation and final delivery policy |
| 5 | `rendering-formatters.js` | 55 | 1,736 | 10 | Pure text, badge and order-label formatters |
| 6 | `rendering.js` | 1,758 | 87,991 | 90 | Dashboard, delivery, customer and modal rendering |
| 7 | `order-settlement.js` | 235 | 10,279 | 15 | Order amount normalization, grouping and monthly sales rendering |
| 8 | `route-map.js` | 762 | 28,321 | 43 | Route page, geocoding cache, map and route proxy |
| 9 | `import-export.js` | 915 | 44,121 | 39 | Text/XLSX import, previews and export |
| 10 | `logen.js` | 296 | 12,449 | 27 | Logen registration and slip lookup UI |
| 11 | `ui.js` | 440 | 18,101 | 37 | Navigation, forms, modals and compatibility wrappers |
| 12 | `notice-memos.js` | 315 | 11,509 | 23 | Delivery notice memo feature in a private IIFE |
| **Total** |  | **6,887** | **296,364** | **397** | **56** | |

The audit found 369 callable function names, 62 shared global state declarations,
3 IIFE-private state declarations, 22 explicit `window`/root exports, 134 static
cross-file call relationships, and 154 inline event attributes referencing 80
distinct call-like names.

## Load-order contract

1. `auth-core.js` initializes Firebase-facing shared state and authentication.
   Some functions refer to later globals, but only execute after authentication
   or DOM lifecycle events.
2. `delivery-transaction.js` must load before every caller that performs an
   atomic completion or cancellation.
3. `imweb.js` declares legacy `markDone`, `undoMarkDone`, and bulk-completion
   handlers.
4. `schedule-report.js` deliberately replaces those handlers with stable
   transaction-backed implementations. It installs them immediately and again
   on lifecycle/timer callbacks to resist late replacement.
5. `rendering-formatters.js` declares ten side-effect-free classic-script globals
   immediately before their rendering consumers.
6. `rendering.js` provides the base `listFor` consumer and `renderDash` renderer.
7. `order-settlement.js` loads after its rendering and formatter dependencies and
   before import paths that normalize incoming order amounts.
8. `ui.js` deliberately wraps `listFor` and wraps `renderDash` twice: once for
   completed-row presentation and once for active-set statistics. These wrappers
   depend on both the schedule and rendering files already being loaded.
9. `notice-memos.js` keeps feature state private, binds the dashboard's existing
   notice navigation to `goTab('notice')`, and exposes only its eight HTML handler
   functions.

Changing this sequence can silently change delivery behavior or remove wrapper
features without producing a syntax error.

## Extracted pure formatters

The extraction moved only the following declarations. Function names,
parameters, bodies after whitespace normalization, return values, and classic
global visibility are unchanged.

| Function | Baseline line | Reads globals | External calls | DOM/Firestore | Input mutation | Decision |
| --- | ---: | --- | --- | --- | --- | --- |
| `escHtml` | 27 | none | none | none | no | moved |
| `firstOrderBadgeHtml` | 63 | none | none | none | no | moved |
| `customerText` | 873 | `escHtml` pure helper | `escHtml` | none | no | moved |
| `customerJsArg` | 877 | `customerText` pure helper | `customerText` | none | no | moved |
| `customerPhoneDigits` | 881 | none | none | none | no | moved |
| `customerTimestampMs` | 933 | none | input `toDate` when supplied | none | no | moved |
| `customerNewBadgeHtml` | 961 | none | none | none | no | moved |
| `customerProductKey` | 1172 | none | none | none | no | moved |
| `customerOrderTypeLabel` | 1176 | `customerProductKey` pure helper | `customerProductKey` | none | no | moved |
| `customerOrderTypeBadge` | 1181 | none | none | none | no | moved |

None is called directly from an HTML inline handler. `escHtml` is also consumed
by `imweb.js` and `import-export.js`; all other calls are from `rendering.js`.
The helper file has no top-level execution beyond function declaration
instantiation and contains no DOM, storage, Firebase, timer, listener, or network
reference.

### Reviewed but excluded

| Candidate | Exclusion reason |
| --- | --- |
| `dashDeliveryRow`, `deliveryProductBadgeHtml` | Depend on mutable cross-file label/class functions and other rendering helpers |
| `customerIsFirstOrder`, `deliveryFirstOrderBadge` | Depend on shared mutable `custs` state |
| `productFilterKey` | Depends on the retained global `SINGLE_PRODUCT_IDS` state |
| `filterDeliveryByProduct` | Reads the DOM |
| `cancelLogTime` | Locale/time-zone display is environment-sensitive and calls retained escape logic |
| `customerOrderTime`, `customerOrderDate` | Date policy and external mutable helper dependency |
| `customerIsNewOrder` | Depends on current time and `CUSTOMER_NEW_BADGE_MS` |
| `customerUniqueBy` | General grouping helper rather than a display/string formatter |
| `customerGroupStatus`, chip helpers | Compose business state and mutable cross-file label functions |
| `customerNextDelivery`, group schedule/remain | Depend on date, schedule, delivery and gauge policy |

## Deliberate overwrites

| Symbol | Initial owner | Final owner | Reason |
| --- | --- | --- | --- |
| `markDone` | `imweb.js` | `schedule-report.js` | Stable transaction-backed employee completion policy |
| `undoMarkDone` | `imweb.js` | `schedule-report.js` | Stable transaction-backed cancellation policy |
| `markAll` | `imweb.js` | `schedule-report.js` | Bulk completion through final policy |
| `markAllDirect` | rendering/legacy path | `schedule-report.js` | Direct-delivery bulk policy |
| `markAllCourier` | rendering/legacy path | `schedule-report.js` | Courier bulk policy |
| `listFor` | `schedule-report.js` | `ui.js` wrapper | Preserve completed rows for presentation |
| `renderDash` | `rendering.js` | `ui.js` wrapper 1 | Completed-row styling |
| `renderDash` | wrapper 1 | `ui.js` wrapper 2 | Active-set statistics |

These are compatibility contracts, not dead duplicates. A future module split
must replace them with one explicit composition point and regression tests before
removing any assignment.

## Accidental duplicate declarations

`rendering.js` contains three declarations of `renderCust`, two of
`showCustomerGroup`, and two of `customerGroupOrderSummary`. Classic-script
hoisting means the last declaration wins. Their removal or consolidation is
deferred because it can change runtime output even when the earlier bodies appear
unused.

## Shared state ownership

| State family | Current owner | Main consumers | Risk |
| --- | --- | --- | --- |
| Authentication, `db`, current user | `auth-core.js` | nearly all files | High: initialization order and credentials boundary |
| `custs`, edit/order selection state | `auth-core.js` | schedule, rendering, route, import/export, UI | High: implicit mutable shared state |
| Selected dates and report mode | `schedule-report.js` | rendering, UI | Medium: date-dependent render coupling |
| Route/map caches and selection | `route-map.js` | route UI | Medium: map SDK lifecycle |
| Import preview state | `import-export.js` | import modals | Medium: parser and write workflow share state |
| Settlement source labels | `order-settlement.js` | settlement rendering and import amount helpers | Low: immutable display mapping |
| Notice memo state | `notice-memos.js` IIFE | exported memo handlers only | Low: already encapsulated |

## Firestore access map

There are 31 static access points. Exact functions and operation types are listed
in the JSON audit.

| Collection | Owners | Use |
| --- | --- | --- |
| `customers` | auth, delivery transaction, Imweb, schedule, rendering, route, import/export, Logen | Customer reads, registration/import, delivery completion, coordinate cache, Logen state |
| `imwebCancelLogs` | Imweb, rendering | Cancellation log writes and display |
| `deliveryCoords` | route map | Geocode cache reads/writes |
| `deliveryNoticeMemos` | notice memos | Memo query/create/update/delete |

The employee index scripts do not directly access `users`, `userPrivate`,
`settlements`, `eventOrders`, `changeRequests`, `adminPushTokens`, or
`chatbotSessions`. Those belong to other application surfaces or backend code.

## DOM and inline-handler coupling

The HTML uses 144 inline event attributes. This makes their referenced globals a
public API even if no JavaScript file imports them. The checker verifies the
documented required handlers still exist and are exported where necessary.
Rendering functions also address page, table, form, modal, toolbar, date, map,
and toast IDs directly. Moving a function without preserving its global name and
DOM availability can break a button while all static JavaScript still parses.

## Delivery policy that must be preserved

- Employee one-time-order completion consumes the remaining order immediately
  (`completeAllForOnce: true`).
- Route-map completion and Imweb/delivery-management completion decrement one
  remaining delivery.
- Regular subscription completion decrements one.
- Repeating the same-date operation must remain idempotent through
  `runDeliveryTransaction`.
- The D5 completion/cancellation asymmetry is intentionally deferred to Issue
  #39; this audit does not normalize it.

## Refactor classification

### A. Cohesive enough to retain

- `delivery-transaction.js`: small policy boundary with explicit exports.
- `order-settlement.js`: order-level amount policy and display grouping without direct writes.
- `logen.js`: cohesive external integration.
- `notice-memos.js`: private state and narrow exports.
- `route-map.js`: large but feature-contained; split only with map lifecycle tests.

### B. Candidates for later extraction

- `rendering.js`: split by dashboard, delivery, and customer rendering.
- `import-export.js`: separate text parsing, spreadsheet parsing, preview, and
  export while preserving public handler names.
- `imweb.js`: separate remote API/import code from legacy UI completion handlers.

### C. Defer until behavior is pinned down

- `auth-core.js` shared initialization and customer CRUD.
- `schedule-report.js` handler installation and completion policy.
- `ui.js` wrapper composition.
- Duplicate declarations in `rendering.js`.
- D5 completion/cancellation behavior.

## Extraction boundary

The first safe extraction is complete in `rendering-formatters.js`. Further
movement from `rendering.js` requires separate approval and new behavior fixtures.
Do not proceed into `auth-core.js`, completion handlers, `ui.js` wrappers, or the
duplicate customer render declarations as part of this extraction.

## Automated guard

Run:

```powershell
node scripts/check-index-js-architecture.js
```

The checker uses Node.js standard libraries only. It validates file order,
documented metrics, required definitions, collection references, protected
overwrite snippets, inline-handler ownership, and the machine-readable audit.
`npm run test:smoke` runs this check before the existing static-page smoke test.
