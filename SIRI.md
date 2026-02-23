# Siri Shortcut Setup (MVP)

This guide configures a simple Siri Shortcut that asks for an item name, calls your API, and reads the location out loud.

## Prerequisites

- API server is running and reachable from the iPhone.
- Endpoint available: `GET /api/items/lookup?q=<query>`
- API returns JSON like:

```json
{
  "query": "where is compressor",
  "intent": "find_item",
  "confidence": 0.91,
  "fallback": false,
  "answer": "Ryobi Air Compressor is in House > Garage > Shelf 2.",
  "item": "Ryobi Air Compressor",
  "location_path": "House > Garage > Shelf 2",
  "notes": "Green, under tarp",
  "requires_confirmation": false
}
```

## 1) Test Endpoint First

From a browser or terminal, verify:

```bash
curl "http://<YOUR-HOST>:4000/api/items/lookup?q=compressor"
```

If this fails, fix server/network first.

## 2) Build Shortcut in iOS

1. Open **Shortcuts** app.
2. Tap **+** to create a new shortcut.
3. Add action **Ask for Input**.
   - Prompt: `What item are you looking for?`
   - Input Type: `Text`
4. Add action **URL**.
   - Value: `http://<YOUR-HOST>:4000/api/items/lookup?q=` then insert the **Provided Input** variable.
5. Add action **Get Contents of URL**.
   - Method: `GET`
   - Headers:
     - If API auth is disabled (`REQUIRE_AUTH=false`): none.
     - If API auth is enabled (`REQUIRE_AUTH=true`): add `Authorization` header with value `Basic <base64(user:pass)>`.
6. Add action **Get Dictionary Value**.
   - Key: `location_path`
7. Add action **If** (Dictionary Value has any value).
   - If true: add **Speak Text** with `It is in [Dictionary Value]`.
   - Otherwise: add **Get Dictionary Value** (key: `notes`) and **Speak Text** with `[Dictionary Value]`.

This handles both match and no-match responses.

## 3) Add Siri Voice Phrase

1. Rename shortcut to something clear, e.g. `Find Household Item`.
2. Open shortcut details and tap **Add to Siri**.
3. Record phrase, e.g. `Where is my item?`

Usage: say the phrase, Siri asks for item, API answer is spoken.
Natural prompts also work, for example:
- `Where is my compressor?`
- `What is in the garage?`
- `How many drill bits do I have?`

## 4) Share With Family

1. Open shortcut.
2. Tap share icon.
3. Send via AirDrop/Messages.
4. Family installs shortcut and updates `<YOUR-HOST>` if needed.

## Troubleshooting

- **Siri says it cannot connect**
  - iPhone cannot reach API host.
  - If local network: use machine LAN IP (not `localhost`).
  - Ensure API is listening on `0.0.0.0` and firewall allows port.

- **Always getting no match**
  - Confirm query term exists in item `name`/`keywords`.
  - Test endpoint directly with the same term.

- **Shortcut returns empty value**
  - Verify response includes `location_path` when there is a match.
  - Verify key spelling in **Get Dictionary Value** is exact.

- **HTTPS requirement outside home network**
  - For internet use, deploy API with HTTPS (AWS ALB/API Gateway + ACM cert).

## MVP Notes

- Keep response small and predictable (`item`, `location_path`, `notes`).
- Auth can be disabled on trusted home LAN only (`REQUIRE_AUTH=false`).
- For public/HTTPS exposure, keep auth enabled and use rate limiting.
