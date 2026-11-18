# Live WhatsApp test (2 weeks)

With this setup, real WhatsApp messages to a **Meta test number** appear on the SlotBee website.
The AI answers in the customer's language, the owner reads every message in English or German,
and the owner can take over and reply. Nobody needs to use a personal WhatsApp number for SlotBee.

```
Tester's WhatsApp ──► Meta test number ──► /api/whatsapp/webhook ──► Gemini (translate + reply)
                                                     │                        │
                                                     ▼                        ▼
                                              Upstash (saves chats)    reply sent on WhatsApp
                                                     │
Website (Conversations, "Live" chats) ◄── /api/whatsapp/conversations (every 4 seconds)
```

## Website test chat (works today, no Meta needed)

Meta locked the new WhatsApp business account until the business is verified, so testers use the
website chat instead. It works like WhatsApp: testers write in any language, the AI answers in that language,
and the owner sees the chat under **Conversations** with a green **Live** label.

- **Tester link:** `https://slotbee.vercel.app/?chat=1&live=YOUR_LIVE_ACCESS_KEY`
- **Owner link:** `https://slotbee.vercel.app/?live=YOUR_LIVE_ACCESS_KEY` → Conversations
- The owner can **Take over** and reply in English or German; the tester gets it in their language.

It needs only Steps 3 and 4 below (Gemini key, Upstash, Vercel settings). The WhatsApp steps are for later,
if the business account is verified.

## What you need (all free)

| What | Where | Used for |
|---|---|---|
| Meta developer account | developers.facebook.com | WhatsApp test number |
| Gemini API key | aistudio.google.com | Replies and translations |
| Upstash Redis | Vercel → Storage | Saving the chats |
| Vercel project `slotbee` | vercel.com | Already exists |

## Step 1: WhatsApp test number

1. Go to **developers.facebook.com** → **My Apps** → **Create app** → choose **Business**.
2. Add the **WhatsApp** product. Open **WhatsApp → API Setup**.
3. Meta creates a **test number** for you. Copy the **Phone number ID**.
4. Under **To**, add the phones that may chat with the test number (about 5). Each phone gets a code on WhatsApp to confirm.
   Use team phones. Testers who don't want to share their number can watch the website while a team phone writes.

## Step 2: A token that lasts 2 weeks

The token on the API Setup page stops working in less than 24 hours. Make a permanent one:

1. Go to **business.facebook.com** → **Settings** → **Users** → **System users** → **Add** (role: Admin).
2. **Assign assets**: your app and your WhatsApp account, with full control.
3. **Generate token** for your app. Choose the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Set expiry to **Never**.
4. Copy the token right away. Meta shows it only once.

Also copy the **App secret**: developers.facebook.com → your app → **App settings → Basic**.

## Step 3: Gemini key and storage

1. **aistudio.google.com** → **Get API key** → copy it.
2. **vercel.com** → project `slotbee` → **Storage** → **Create** → **Upstash for Redis** (free plan) → connect it to the project.
   Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` by itself.

## Step 4: Settings in Vercel

Project `slotbee` → **Settings → Environment Variables**. Add:

| Name | Value |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | from Step 1 |
| `WHATSAPP_ACCESS_TOKEN` | from Step 2 |
| `WHATSAPP_APP_SECRET` | from Step 2 |
| `WHATSAPP_VERIFY_TOKEN` | any word you choose, e.g. `bella-salon-2026` |
| `GEMINI_API_KEY` | from Step 3 |
| `LIVE_ACCESS_KEY` | a long random word; this is the tester link key |

Then **deploy** the branch (Vercel → Deployments → Redeploy, or merge and push).

## Step 5: Connect the webhook

1. developers.facebook.com → your app → **WhatsApp → Configuration** → **Webhook** → **Edit**.
2. **Callback URL**: `https://slotbee.vercel.app/api/whatsapp/webhook`
3. **Verify token**: the same word as `WHATSAPP_VERIFY_TOKEN` → **Verify and save**.
4. Under **Webhook fields**, **subscribe** to `messages`.

## Step 6: Test it

1. Open `https://slotbee.vercel.app/?live=YOUR_LIVE_ACCESS_KEY` once. The browser remembers the key.
2. From an allowed phone, send a WhatsApp message to the test number, e.g. *"Bonjour, avez-vous un rendez-vous jeudi ?"*
3. Within a few seconds the chat appears under **Conversations** with a green **Live** label.
   The AI replies on WhatsApp in French, and the website shows the message in the owner's language.
4. Click **Take over** to reply yourself. Type in English or German; the customer receives it in French.
   Click **Let AI continue** to hand the chat back to the AI.

Without the `?live=` link, the website is the normal demo. GitHub Pages and `npm run dev` always stay the demo,
because they have no server.

## How the AI behaves

The AI gets the demo salon's services, prices and opening hours, and the owner's handover rules
(discounts, complaints, bookings outside opening hours, cancellations). It answers only booking questions,
in the customer's language. It cannot see the live calendar, so it suggests times and says the salon confirms.
Handover topics mark the chat **Needs you** on the website. The rules are in `server/ai.ts` (`salonContext`).

## Limits

- Only the phones added in Step 1 can chat with the test number.
- WhatsApp lets the business reply freely only within **24 hours** of the customer's last message.
- The test number shows as a test account on WhatsApp.
- Bookings are not added to the website's calendar. The demo calendar lives in each browser.

## Privacy

Testers' messages and names are saved in Upstash. The website shows only a shortened phone number.
Tell testers this before they write. Each chat is deleted automatically after 30 days. To delete earlier:
Upstash console → Data Browser → delete all keys that start with `slotbee:live:` (and `slotbee:preview:live:` for chats written on previews). Also remove the test phones in Meta and delete the system user token.

## Previews of work branches keep their own chats

Vercel builds a preview address for every branch. A preview of a work branch keeps its own test chats:
it cannot show, change or delete the chats of the live site, and it cannot take over the Telegram bot or
the WhatsApp number. The live site, and previews of `nil-live-whatsapp`, use the live chats as before.

This relies on Vercel telling each copy that it is a preview and which branch it was built from (the project
setting "Automatically expose System Environment Variables", which is on by default). To see what a copy does,
open `/api/space?key=YOUR_LIVE_ACCESS_KEY` on it. It answers `"dataSpace": "live"` or `"dataSpace": "preview"`
and changes nothing. If Vercel tells a copy nothing, the copy keeps using the live chats, as before.

One optional setting: `LIVE_DATA_SPACE=live`, set in Vercel **for one preview branch only**, makes that preview
use the live chats. Use it when another branch takes over the live address. No setting can move the live site
away from its chats. Chats of previews are stored under keys that start with `slotbee:preview:live:`.

Before every Vercel build the type check and the tests run (`npm run build:checked`, set in `vercel.json`).
If one fails, the build stops and the site that is already online stays as it is.

## If something does not work

| Problem | Likely cause |
|---|---|
| Meta says the callback URL could not be verified | `WHATSAPP_VERIFY_TOKEN` differs, or the branch is not deployed |
| Messages arrive on the phone but not on the website | `messages` field not subscribed, wrong `WHATSAPP_APP_SECRET`, or wrong `?live=` key |
| The AI does not reply; Vercel logs show error 190 | Token expired: use the system user token from Step 2 |
| Vercel logs show error 131030 | The phone is not in the allowed list from Step 1 |
| Chat shows "The AI could not answer" | Check `GEMINI_API_KEY` and the Vercel function logs |
| A preview address shows none of the live chats | Intended: previews of work branches keep their own chats (see above). Check with `/api/space` |
| The live address suddenly shows none of the old chats after a branch change | Open `/api/space` there; if it says `preview`, set `LIVE_DATA_SPACE=live` for that branch |
| `/api/telegram/setup` answers "only possible on the live site" | It was opened on a preview of a work branch; open it on the live address |
| Meta cannot verify the callback URL on a preview address | Intended: only the live site accepts the WhatsApp webhook |
| The Vercel build stops before "vite build" | The type check or a test failed: the build log names it |
