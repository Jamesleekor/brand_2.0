export const RECORDS_TIER_ICONS_2023 = {
  MASTER: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/tier_icon/2023Rankicon_Master.png',
  CELESTIAL_MASTER: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/tier_icon/2023Rankicon_Celestial-Master.png',
  GRAND_MASTER: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/tier_icon/2023Rankicon_Grand-Master.png',
} as const;

export const RECORDS_GUILD_LOGOS_2026 = {
  season1: {
    Ruby: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/Ruby.png',
    '빛나는 은하수': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/Milkyway.png',
    '암흑장미': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/Darkrose.png',
    '에메랄드': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/EMERALD.png',
  },
  season2: {
    '아블루션': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Ablution.png',
    '루나 네이비': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-LunaNavy.png',
    '피닉스': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Phoenix.png',
    '슈퍼노바': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Supernova.png',
    '와사비': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Wasabi.png',
  },
} as const;

export const RECORDS_GUILD_LOGO_BY_NAME: Record<string, string> = {
  ...RECORDS_GUILD_LOGOS_2026.season1,
  ...RECORDS_GUILD_LOGOS_2026.season2,
};
