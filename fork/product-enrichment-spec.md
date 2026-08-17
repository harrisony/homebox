# Product lookup providers and AI enrichment

Fork-only feature spec. Two related features sharing one contract and one UI surface:

- **A. External product providers.** A pluggable lookup service so retailer-specific
  scrapers (Bunnings, Kmart, Officeworks) can answer barcode and store-item-code
  queries without their code living in Homebox.
- **B. AI enrichment.** Give a product URL or a receipt photo, get back the same
  result shape.

Design status: A is decided. B has one open question. Deployment packaging and
image transport are open by choice, listed in "Open questions".

## What exists today

`GET /v1/products/search-from-barcode?productEAN=` returns `[]repo.BarcodeProduct`
(`backend/app/api/handlers/v1/v1_ctrl_product_search.go:465`).

| Fact | Where | Consequence |
| --- | --- | --- |
| Five providers hardcoded as inline funcs in the HTTP handler | `v1_ctrl_product_search.go:174-414` | No service layer, no seam to add a sixth |
| Providers called sequentially, 10s timeout each | `:485-505` | 50s worst case; no shared budget |
| One image per result, base64-inlined, 8 MB cap each | `:416-454`, `:507-528` | A 5-photo result would be a 40 MB JSON body |
| Frontend rejects anything non-numeric | `frontend/components/Item/BarcodeModal.vue:203` | "Bunnings I/N 0123456" cannot be typed |
| Only name, description, manufacturer, modelNumber, one photo reach the item | `frontend/components/Entity/CreateModal.vue:545-566` | Price, category, dimensions all dropped |
| API keys exist, peppered hashes | `backend/internal/data/ent/schema/api_key.go` | A separate app could authenticate if we wanted one |
| External link attachments exist | `POST /v1/entities/{id}/attachments/external` | Product page URLs have a home already |

So this is mostly generalisation, not greenfield.

## A. External product providers

### Shape

Homebox holds a URL for one provider service. That service hosts any number of
retailer providers and declares what each one accepts. Homebox routes by
identifier kind and never knows a retailer's name at compile time.

The five built-in providers stay exactly as they are. The sidecar is bolted on
beside them, not merged into them.

### Provider service contract

Two endpoints, both under the configured base URL.

**`GET {base}/providers`** returns the manifest:

```json
{
  "providers": [
    {
      "id": "bunnings",
      "name": "Bunnings Warehouse",
      "country": "AU",
      "accepts": ["barcode", "item_code"],
      "code_label": "I/N",
      "code_hint": "7 digits, on the shelf label"
    },
    {
      "id": "kmart",
      "name": "Kmart Australia",
      "country": "AU",
      "accepts": ["item_code"],
      "code_label": "Product code"
    }
  ]
}
```

`accepts` is the routing key, and it is per provider because the sources genuinely
differ: some take both, some only a barcode, some only a store code.

`code_label` and `code_hint` are display-only. Homebox does no client-side format
validation on store codes. The numeric-only check at `BarcodeModal.vue:203` is
exactly the mistake not to repeat.

**`POST {base}/lookup`**:

```json
{ "kind": "item_code", "identifier": "0123456", "providers": ["bunnings"] }
```

`kind` is `barcode` or `item_code`. `providers` is optional; omitted means every
provider that accepts that kind.

The response is HTTP 200 even on partial failure, because partial failure is the
normal case when three sites are queried and one is down:

```json
{
  "results": [
    {
      "provider_id": "bunnings",
      "provider_name": "Bunnings Warehouse",
      "identifier": "0123456",
      "name": "Ryobi ONE+ 18V Cordless Drill Driver",
      "description": "...",
      "manufacturer": "Ryobi",
      "model_number": "R18DD3-0",
      "product_url": "https://www.bunnings.com.au/...",
      "price": { "amount": 129.00, "currency": "AUD" },
      "images": ["https://...", "https://..."],
      "attributes": [
        { "name": "Weight", "value": "1.4", "unit": "kg", "type": "number" },
        { "name": "Colour", "value": "Green", "type": "text" }
      ]
    }
  ],
  "errors": [
    { "provider_id": "kmart", "message": "upstream returned 503" }
  ]
}
```

### Homebox configuration

New `ProductProviderConf` in `backend/internal/sys/config/conf.go`, with its own
`MarshalJSON` redaction following the `BarcodeAPIConf` pattern at `conf.go:151-163`.

| Variable | Default | Notes |
| --- | --- | --- |
| `HBOX_PRODUCT_PROVIDER_URL` | empty | Empty disables the sidecar path entirely |
| `HBOX_PRODUCT_PROVIDER_TOKEN` | empty | `conf:"mask"`, sent as `Authorization: Bearer` |
| `HBOX_PRODUCT_PROVIDER_TIMEOUT` | `8s` | Whole-call budget, not per provider |

Startup validation fails closed: it logs an error and disables the provider path
rather than refusing to boot.

- Non-loopback host with scheme other than `https`: disabled.
- Non-loopback host with an empty token: disabled.
- Loopback (`127.0.0.1`, `::1`, `localhost`) may use `http` with no token.

The service can run anywhere, so it can be exposed. Requiring a token off-loopback
is what stops the scraper endpoint becoming an open proxy.

### Homebox endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/products/providers` | Cached manifest, 5 min TTL. Returns `[]` when disabled, so the frontend hides the Store code tab with no separate feature flag |
| `GET /v1/products/lookup?kind=&identifier=&provider=` | Returns `{results, errors}` |
| `GET /v1/products/search-from-barcode` | Kept, delegating to lookup with `kind=barcode`. Keeps the scanner path and any existing client working |

`repo.BarcodeProduct` gains `ProductURL`, `Price`, `Currency`, `Images []string`,
`Attributes []ProductAttribute`. `ImageURL` and `ImageBase64` stay until the image
question below is settled.

Built-ins and the sidecar are queried concurrently under one timeout budget. A
sidecar failure is logged, reported in `errors`, and does not suppress built-in
results.

### Field mapping

| Provider field | Homebox destination |
| --- | --- |
| `name` | `EntityCreate.Name` |
| `description` | `EntityCreate.Description` |
| `manufacturer` | `manufacturer` |
| `model_number` | `modelNumber` |
| `price.amount` | `purchasePrice`, prefilled and editable |
| `provider_name` | `purchaseFrom` |
| `product_url` | External link attachment, `source_type: "link"` |
| `attributes[]` | `EntityField` rows |
| `images[]` | Photo attachments |

Two caveats worth stating rather than discovering later:

- `price` is today's shelf price, not what was paid. It prefills `purchasePrice`
  and stays editable. `purchaseDate` is not set, because the provider does not
  know it.
- `EntityField.number_value` is `field.Int` (`schema/entity_field.go:32`), so
  "1.4 kg" cannot be a number field. Non-integral attributes land as text
  (`"1.4 kg"`). Widening that column to a float is a dual migration and is out of
  scope here.

Retailer category is deliberately not mapped to tags. It generates tag sprawl for
little gain.

### UI

`Item/BarcodeModal.vue` becomes a three-tab dialog under the existing
`DialogID.ProductImport`. All three tabs produce the same result list and the same
"Import selected" handoff to `Entity/CreateModal` via `DialogID.CreateEntity`. Only
the input differs.

| Tab | Input | Queries |
| --- | --- | --- |
| Barcode | One field, numeric, max 80 (matching the backend's `validate:"required,max=80"`) | The 5 built-ins plus every sidecar provider accepting `barcode` |
| Store code | Store dropdown from `/providers`, then a code field labelled with `code_label` | The selected provider only |
| AI | See feature B | Hidden entirely when `HBOX_AI_ENABLED` is false |

The scan path is untouched: `App/ScannerModal.vue:92` still opens
`ProductImport` with `params.barcode`, landing on the Barcode tab. Scanned input
is always UPC or EAN, so it never needs a store hint. Typed store codes are the
only case where the user knows the retailer, and that is where the dropdown lives.

## B. AI enrichment

Off by default. A third tab in the same modal, plus the enrich action described
below.

### Configuration

| Variable | Default |
| --- | --- |
| `HBOX_AI_ENABLED` | `false` |
| `HBOX_AI_BASE_URL` | empty |
| `HBOX_AI_API_KEY` | empty, `conf:"mask"` |
| `HBOX_AI_MODEL` | empty |
| `HBOX_AI_TIMEOUT` | `60s` |
| `HBOX_AI_MAX_IMAGE_MB` | `5` |

One base URL against an OpenAI-compatible `/chat/completions` covers OpenAI,
OpenRouter, LiteLLM, Ollama, and vLLM without further code.

Known constraint: Anthropic's first-party API is the Messages API, which is not
OpenAI-shaped. Pointing `HBOX_AI_BASE_URL` straight at `api.anthropic.com` will
not work. Route via OpenRouter or LiteLLM, or add a second adapter later. This is
a documentation item, not a blocker.

### Inputs and endpoint

Two inputs: a product page URL, and a photo of a receipt or packaging label.
Free-text description and photo-of-the-item are out of scope.

`POST /v1/products/enrich`:

```json
{ "kind": "url",   "url": "https://..." }
{ "kind": "image", "image": "<base64 data URI>", "hint": "receipt" }
```

Response reuses the provider result shape so the results table and the
create-modal handoff work verbatim:

```json
{ "candidates": [ /* same shape as provider results */ ] }
```

`candidates` is a list from day one even though only the first is used today.
Multi-line receipt splitting then becomes additive rather than a redesign.

The model call uses JSON-schema structured output, so the response is parsed
rather than scraped out of prose. The image path uses vision input.

Enrichment sits behind the existing user auth middleware. No new rate limiting is
proposed until the URL-fetch question below is settled.

### Receipt handling

A receipt supplies purchase metadata for the one item being created: purchase
date, price paid, retailer. It also becomes a `receipt`-type attachment on the
item. Where a receipt has many lines, the user picks the line. Splitting a receipt
into several items is out of scope for now.

Note that a receipt gives the price actually paid, unlike the provider `price`
field. When both are present, the receipt wins.

## Enriching an existing item

Applies to both features. An "Enrich" action on an item page takes an identifier
or a URL, runs the same lookup or AI path, and shows a field-by-field diff before
anything is written:

- Blank fields: prefilled, ticked by default.
- Populated fields: old and new shown side by side, unticked by default.
- Images: offered as additional attachments, never replacing the primary photo.

Nothing applies until confirmed. It uses the existing entity update and attachment
endpoints, so there is no new persistence.

## Open questions

**1. Deployment packaging.** The contract is identical under all of these, so this
can be answered after the contract lands.

| Option | Cost |
| --- | --- |
| Provider service runs anywhere, Homebox holds a URL | Lookups fail silently whenever it is down. Current lean |
| Bundled into the Homebox image as a second process | One container, one `docker compose up`, image grows for a Python runtime |
| Optional second container in compose | Cleanest separation, genuinely a second thing to keep alive |
| Rewrite the scrapers in Go, in-process | No sidecar at all; porting cost, and the scrapers live in this fork forever |

**2. Image count and transport.** Today: one image, base64-inlined, 8 MB cap,
fetched synchronously in the handler.

| Option | Cost |
| --- | --- |
| Many, fetched server-side, served as short-lived proxy URLs | Needs a small cache plus a proxy endpoint |
| Many, base64 inline | Zero new endpoints; a 5-photo result is a very large JSON body over a phone connection |
| Keep exactly one | No work, lose the extra photos the retailer sites have |
| Thumbnails first, full images only for ticked photos | Leanest network use, most moving parts |

The contract's `images` field is already a list, so only the transport is
undecided.

**3. Who fetches a product URL for AI.** This one does gate implementation.

| Option | Implication |
| --- | --- |
| Homebox fetches, model reads the text | Needs an SSRF-guarded fetcher (no private IPs, size cap, timeout) and an HTML-to-text step. Works with a local model; the fetch is auditable |
| Model fetches it itself | No backend fetching code; better on JS-heavy pages; locks the feature to hosted web-capable models |
| Homebox extracts OpenGraph and JSON-LD only | Very cheap in tokens, often sufficient for retail pages, needs a full-text fallback |

## Out of scope

- Bulk backfill across many items.
- Storing the raw provider payload on the item.
- Mapping retailer category onto tags.
- Free-text and item-photo AI inputs.
- Refactoring the five built-in providers behind the new interface.
- Upstreaming any of this.

## Build order

Each step ships and is useful on its own.

1. Provider contract, config, `/v1/products/providers`, `/v1/products/lookup`.
   Sidecar can be a stub returning fixed data.
2. Two-tab modal. Store code tab wired to the manifest.
3. Field mapping: price, `purchaseFrom`, external link attachment, custom fields.
4. AI config, `/v1/products/enrich`, third tab.
5. Enrich an existing item.

Steps 1 to 3 are worth doing regardless of how the deployment question lands.
