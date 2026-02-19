"use client";

import Image from "next/image";

type PlayerAvatarProps = {
  nick: string;
  size?: number;
  radius?: number;
};

const AVATAR_TOTAL = 200;

function hashNick(nick: string) {
  let hash = 0;
  for (let i = 0; i < nick.length; i += 1) {
    hash = (hash * 31 + nick.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getPlayerAvatarSrc(nick: string) {
  const cleanNick = nick.trim().toLowerCase();
  const index = (hashNick(cleanNick || "player") % AVATAR_TOTAL) + 1;
  const file = String(index).padStart(3, "0");
  return `/avatars/avatar_${file}.png`;
}

export function PlayerAvatar({ nick, size = 36, radius = 16 }: PlayerAvatarProps) {
  const cleanNick = nick?.trim() || "Player";
  const src = getPlayerAvatarSrc(cleanNick);

  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        position: "relative",
        overflow: "hidden",
        padding: 0,
      }}
    >
      <Image
        src={src}
        alt={cleanNick}
        fill
        sizes={`${size}px`}
        style={{ objectFit: "cover" }}
      />
    </div>
  );
}
