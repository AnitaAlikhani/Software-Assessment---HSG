import process from 'node:process';

const graphVersion = () => process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0';

/** Sends a plain text message from the SlotBee test number to a WhatsApp user. */
export async function sendWhatsAppText(to: string, body: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !token) throw new Error('WhatsApp is not configured');
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body } }),
  });
  if (!response.ok) {
    // Error 190: expired token. Error 131030: the number is not on the test number's allowed list.
    const detail = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}
