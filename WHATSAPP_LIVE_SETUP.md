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
and the owner sees the chat under **Conversations**.

- **Tester link:** `https://slotbee.vercel.app/?chat=1&live=YOUR_LIVE_ACCESS_KEY&research=1`
  With `&research=1` the page tells study participants that this is a student test. Without it, the same page
  uses the wording a salon's customers read (see "Study tools and study wording" below).
- **Owner link:** `https://slotbee.vercel.app/?live=YOUR_LIVE_ACCESS_KEY&research=1` → Conversations
  With `&research=1` the owner sees the study tools: a green **Live** label on these chats and, above the inbox,
  the live-test strip with the tester link to copy. Without it the chats arrive all the same, but nothing marks
  them as live and the strip is hidden.
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

1. Open `https://slotbee.vercel.app/?live=YOUR_LIVE_ACCESS_KEY&research=1` once. The browser remembers the key
   and that study tools are on.
2. From an allowed phone, send a WhatsApp message to the test number, e.g. *"Bonjour, avez-vous un rendez-vous jeudi ?"*
3. Within a few seconds the chat appears under **Conversations** with a green **Live** label (a study tool:
   without `research=1` the chat appears without the label).
   The AI replies on WhatsApp in French, and the website shows the message in the owner's language.
4. Click **Take over** to reply yourself. Type in English or German; the customer receives it in French.
   Click **Let AI continue** to hand the chat back to the AI.

Without the `?live=` link, the website is the normal demo. GitHub Pages and `npm run dev` always stay the demo,
because they have no server.

## How the AI behaves

The AI gets the demo salon's services, prices and opening hours, and the owner's handover rules
(discounts, complaints, bookings outside opening hours, cancellations). It answers only booking questions,
in the customer's language. It cannot see the live calendar, so it suggests times and says the salon confirms.
Handover topics mark the chat **Waiting for you** on the website. The rules are in `server/ai.ts` (`salonContext`).

## Limits

- Only the phones added in Step 1 can chat with the test number.
- WhatsApp lets the business reply freely only within **24 hours** of the customer's last message.
- The test number shows as a test account on WhatsApp.
- Bookings are not added to the website's calendar. The demo calendar lives in each browser.

## Privacy

What customers are told is what the system does. Every text takes the period from `CHAT_RETENTION_DAYS` in
`src/customerNotice.ts`, the same number the storage uses (`server/store.ts`). Change the period only there.

- **How long:** a chat is deleted automatically 14 days after its last activity. Every new message, every reply and
  every owner action in the chat (Take over, Confirm booking) starts the 14 days again.
- **What is stored (Upstash):** the messages with their English and German translation, the name (the first name
  typed into the website chat, the Telegram name, or the WhatsApp profile name), the language, a booking request the
  AI collected, and the customer's id: a random id for the website chat, the Telegram chat id, or the WhatsApp number.
  A WhatsApp chat also notes that its first message (see "What customers read") has been sent.
  The website shows only a shortened phone number.
- **Where the id is:** each chat is one key, `slotbee:live:chat:<id>`, and that key is the only place where a
  customer's id can be read. There is no list of chats beside it: the inbox finds the chats by their key names. So
  when Upstash deletes a chat after its 14 days, nothing of the customer is left, whether anybody writes or not.
  The storage holds two more kinds of keys, both named after a hash (SHA-256) instead of the id itself:
  `slotbee:live:msg:<hash of a message id>` for two days, so that a message Telegram or Meta delivers twice is
  answered once (a WhatsApp message id contains the sender's number, which is why it is hashed), and the deletion
  marker described below.
- **Who processes the messages:** Google Gemini writes the answers and the translations (each new message is sent
  there with the last ten messages of the chat). Upstash stores the chats, Vercel runs the website, and Telegram or
  Meta deliver the messages on their own channel.
- **What customers read:** the website chat says all of this on its start screen. Telegram says it in answer to
  `/start`, in German, French, Italian or English after the language of the customer's app. WhatsApp customers get
  one fixed first message before the first AI answer. These texts are fixed; the AI does not write them.
  If a text cannot be sent, it is not lost: on WhatsApp the customer still gets the answer, and the fixed message
  goes out before the next message to them (an AI answer or your reply) until it has been sent once. On Telegram the
  `/start` is handed back to Telegram, which delivers it again.
- **Deleting earlier:** customers delete their own chat at any time with **Delete chat** in the menu of the website
  chat, or by sending `/delete` on Telegram or WhatsApp. On the website a customer can start a **New chat**; the
  salon keeps the earlier one for its 14 days. The customer's browser remembers the ids of such earlier chats (ids
  only, at most ten, no longer than the storage period), and **Delete chat** removes them together with the current
  chat. To delete everything: Upstash console → Data Browser →
  delete all keys that start with `slotbee:live:` (and `slotbee:preview:live:` for chats written on previews). Also
  remove the test phones in Meta and delete the system user token.
- **A deleted chat stays deleted:** the chat is removed at once. An answer that was still on its way (the AI or a
  translation can take many seconds) cannot store it again: deleting leaves a marker for ten minutes,
  `slotbee:live:gone:<hash of the id>` with a random value, and a chat is only saved if no deletion happened since it
  was loaded. Ten minutes is longer than any request can run (the AI gives up after about a minute, Vercel ends a
  function after five). The marker cannot be read as a number or id; someone who already knows a number could work
  out that its chat was deleted in the last ten minutes, nothing more. A customer who writes again after deleting
  starts a new, empty chat. In the inbox, an action on a chat that its customer deleted in that moment answers
  "This chat was deleted by the customer.": the chat is not stored again and the reply is held back (only a deletion
  in the very second of sending can still cross it).
- **The list of chats of the earlier version:** that version kept a list of all customer ids
  (`slotbee:live:index`), and an id stayed in it after its chat had expired. This version never adds to the list and
  does not need it. It takes an id out when its chat is deleted, and whenever a chat is saved (at most once an hour
  per running copy) it takes out every id whose chat is gone; the list disappears with its last id, or at the latest
  when the lifetime the earlier version gave it ends (30 days from that version's last save). The list is not deleted
  outright because a copy that still runs the earlier version finds its chats through it. Chats first saved by this
  version are not in the list, so such a copy does not show them. **Once every copy runs this version, delete the
  key `slotbee:live:index` by hand in the Upstash console:** nothing reads it any more, and that removes the old ids
  without waiting.
- **Chats from before this rule:** a chat saved by the earlier version was given 30 days and keeps them until
  something happens in it. From then on it follows the 14 days. The update itself deletes nothing.
  The very first version kept all chats in one key without an end date, `slotbee:live-whatsapp`. Nothing reads it
  any more. If the Data Browser still shows it, delete it by hand.

### Study tools and study wording

Study participants must read that this is a student test. Customers of a salon must not. So everything that
belongs to a study stays hidden until study tools are switched on.

- **On the website:** add `research=1` to the address once (`?research=1`, or `&research=1` after `?live=...`).
  The browser remembers it; `research=0` ends it. Only with study tools on does the website show
  - the green **Live** label on live chats and the live-test strip above **Conversations**,
  - the study notice in the customer chat ("This is a student test (HSG)"),
  - the pilot banner with **Register interest**, and the helpers **Simulate incoming booking** and
    **Reset demo data**.
- **Tester links therefore need `research=1`.** Without it a tester reads the wording a salon's customers read,
  with no study notice. The website-chat link in the live-test strip already carries it.
- **Telegram and WhatsApp:** a messenger chat has no address to add this to. Set `RESEARCH_MODE=1` in Vercel while
  a study runs. The welcome and the first message then say "student project at HSG". Remove the setting before
  real customers use these channels.

## Previews of work branches keep their own chats

Vercel builds a preview address for every branch. A preview of a work branch keeps its own test chats:
it cannot show, change or delete the chats of the live site, and it cannot take over the Telegram bot or
the WhatsApp number. The live site, and previews of `nil-live-whatsapp`, use the live chats as before.

This relies on Vercel telling each copy that it is a preview and which branch it was built from (the project
setting "Enable access to System Environment Variables" under Environment Variables). To see what a copy does,
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
| The inbox says "This chat was deleted by the customer." | The customer deleted the chat while your reply or confirmation was on its way. The chat was not stored again and the reply was held back; the chat leaves the list a few seconds later |
| A preview address shows none of the live chats | Intended: previews of work branches keep their own chats (see above). Check with `/api/space` |
| The live address suddenly shows none of the old chats after a branch change | Open `/api/space` there; if it says `preview`, set `LIVE_DATA_SPACE=live` for that branch |
| `/api/telegram/setup` answers "only possible on the live site" | It was opened on a preview of a work branch; open it on the live address |
| Meta cannot verify the callback URL on a preview address | Intended: only the live site accepts the WhatsApp webhook |
| The Vercel build stops before "vite build" | The type check or a test failed: the build log names it |
