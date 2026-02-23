# Siri Shortcut Setup (MVP)

This guide configures a Siri Shortcut that asks a natural-language inventory question, calls your API, and speaks the assistant response.

## Prerequisites

- API server is running and reachable from the iPhone.
- Endpoint available: `GET /api/items/lookup?q=<query>` (alias: `GET /shortcut/find-item?q=<query>`)
- Auth mode chosen (`REQUIRE_AUTH` or `REQUIRE_USER_ACCOUNTS`; do not run both on-app at once).
- API returns JSON like:

```json
{
  "query": "where is my compressor",
  "normalized_query": "where is my compressor",
  "intent": "find_item",
  "confidence": 0.69,
  "fallback": false,
  "answer": "Ryobi Air Compressor is in House > Garage > Shelf 2.",
  "item": "Ryobi Air Compressor",
  "location_path": "House > Garage > Shelf 2",
  "notes": "Green, under tarp",
  "match_count": 1,
  "requires_confirmation": false
}
```

## 1) Test Endpoint First

From a browser or terminal, verify:

```bash
curl "http://<YOUR-HOST>:4000/api/items/lookup?q=where%20is%20my%20compressor"
```

If this fails, fix server/network first.

## 2) Build Shortcut in iOS

1. Open **Shortcuts** app.
2. Tap **+** to create a new shortcut.
3. Add action **Ask for Input**.
   - Prompt: `What do you want to know about your inventory?`
   - Input Type: `Text`
4. Add action **URL**.
   - Value: `http://<YOUR-HOST>:4000/api/items/lookup?q=` then insert the **Provided Input** variable.
   - Optional but recommended: add **URL Encode** on input text before appending.
5. Add action **Get Contents of URL**.
   - Method: `GET`
   - Headers:
     - If both `REQUIRE_AUTH=false` and `REQUIRE_USER_ACCOUNTS=false`: none.
     - If `REQUIRE_AUTH=true`: add `Authorization: Basic <base64(user:pass)>`.
     - If `REQUIRE_USER_ACCOUNTS=true`: add `Authorization: Bearer <session_token>`.
     - If using household sharing and account auth: add `x-household-id: <household_uuid>` to scope answers to one household.
6. Add action **Get Dictionary Value**.
   - Key: `answer`
7. Add action **Speak Text** with the `answer` value.
8. Optional safety step:
   - Read key `requires_confirmation`.
   - If `true`, speak a caution like: `Action request detected. Manual confirmation required in app.`
9. Optional fallback step:
   - If `answer` is empty, read key `notes` and speak that instead.

This gives natural responses for find/list/count prompts while handling guarded requests safely.

## 3) Add Siri Voice Phrase

1. Rename shortcut to something clear, e.g. `Find Household Item`.
2. Open shortcut details and tap **Add to Siri**.
3. Record phrase, e.g. `Where is my item?`

Usage: say the phrase, Siri asks for item, API answer is spoken.
Natural prompts also work, for example:
- `Where is my compressor?`
- `What is in the garage?`
- `How many drill bits do I have?`
- `Move the drill to attic` (returns guarded response requiring confirmation)

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
  - Confirm items/locations exist in the selected household scope.
  - If using account auth, verify bearer token and optional `x-household-id`.
  - Confirm query term exists in item `name`/`description`/`keywords`.
  - Test endpoint directly with the same term.

- **Shortcut returns empty value**
  - Verify response includes `answer`.
  - Verify key spelling in **Get Dictionary Value** is exact.

- **HTTPS requirement outside home network**
  - For internet use, deploy API with HTTPS (AWS ALB/API Gateway + ACM cert).

## MVP Notes

- Response is raw JSON (not envelope-wrapped) for Shortcut compatibility.
- Core fields for Siri flow: `answer`, `intent`, `confidence`, `fallback`, `requires_confirmation`.
- Auth can be disabled on trusted home LAN only (`REQUIRE_AUTH=false` and `REQUIRE_USER_ACCOUNTS=false`).
- For public/HTTPS exposure, keep auth enabled and use rate limiting.
