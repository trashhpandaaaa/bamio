import { Broadcast, Globe, TwitchLogo, UploadSimple, YoutubeLogo, type IconProps } from "@phosphor-icons/react";
import type { Platform } from "@/lib/clips/schema";

const ICONS = { youtube: YoutubeLogo, twitch: TwitchLogo, kick: Broadcast, upload: UploadSimple, other: Globe } as const;

export function PlatformIcon({ platform, ...props }: { platform: Platform } & IconProps) {
  const Icon = ICONS[platform];
  return <Icon aria-hidden {...props} />;
}
