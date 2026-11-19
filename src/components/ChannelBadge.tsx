import React from 'react';
import { Camera, Globe, MessageCircle, Send } from 'lucide-react';

/** Where a customer can reach the salon's assistant. */
export type ChannelKind = 'WhatsApp' | 'Instagram' | 'Website' | 'Telegram';

const LOOK: Record<ChannelKind, { label: string; classes: string; Icon: typeof Globe }> = {
  WhatsApp: { label: 'WhatsApp', classes: 'bg-[#25D366] text-white', Icon: MessageCircle },
  Instagram: { label: 'Instagram', classes: 'bg-fuchsia-500 text-white', Icon: Camera },
  Telegram: { label: 'Telegram', classes: 'bg-sky-500 text-white', Icon: Send },
  Website: { label: 'Website chat', classes: 'bg-slate-700 text-white', Icon: Globe },
};

/** The channel's name as the owner reads it, e.g. "Website chat". */
export const channelLabel = (channel: ChannelKind): string => LOOK[channel].label;

/** A round channel symbol, for the list of channels. Decorative: the name stands next to it. */
export const ChannelIcon: React.FC<{ channel: ChannelKind }> = ({ channel }) => {
  const { classes, Icon } = LOOK[channel];
  return (
    <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${classes}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
};

/**
 * The small channel mark on a chat's avatar. It replaces a text chip, so screen readers
 * get the channel as words. Place it inside a `relative` box around the avatar.
 */
export const ChannelBadge: React.FC<{ channel: ChannelKind }> = ({ channel }) => {
  const { label, classes, Icon } = LOOK[channel];
  return (
    <span title={label} className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2 ring-white ${classes}`}>
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      <span className="sr-only">via {label}</span>
    </span>
  );
};
