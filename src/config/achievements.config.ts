/**
 * Achievement badge definitions.
 * Each badge has a unique ID, display info, and an AdrianLAB ERC1155 tokenId for on-chain minting.
 *
 * Token ID range: 20000-20099 (reserved for ZEROadventure achievements in AdrianLAB)
 */

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** AdrianLAB ERC1155 token ID for on-chain mint */
  tokenId: number;
  /** Category for grouping in the badge panel */
  category: 'chapter' | 'secret' | 'holder' | 'explorer';
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ─── Chapter progression ─────────────────────────
  {
    id: 'ch1_complete',
    name: 'Breaking & Entering',
    description: 'Completed Chapter 1 — found the code and entered AdrianLAB',
    tokenId: 20001,
    category: 'chapter',
  },
  {
    id: 'ch2_complete',
    name: 'The Receptionist',
    description: 'Completed Chapter 2 — explored the trading floor and rooftop',
    tokenId: 20002,
    category: 'chapter',
  },
  {
    id: 'ch3_complete',
    name: 'Below the Surface',
    description: 'Completed Chapter 3 — discovered the basement and server room',
    tokenId: 20003,
    category: 'chapter',
  },
  {
    id: 'ch4_complete',
    name: 'The Mountain Path',
    description: 'Completed Chapter 4 — reached the clinic and met Dr. Satoshi',
    tokenId: 20004,
    category: 'chapter',
  },
  {
    id: 'patient_zero',
    name: 'Patient Zero',
    description: 'Identity revealed — you found the truth',
    tokenId: 20005,
    category: 'chapter',
  },
  {
    id: 'game_complete',
    name: 'ZEROadventure II',
    description: 'Completed the entire game — the ecosystem is saved',
    tokenId: 20006,
    category: 'chapter',
  },

  // ─── Holder exclusives ───────────────────────────
  {
    id: 'holder_vip_floppy',
    name: 'VIP Floppy Disc',
    description: 'AdrianZERO holder reward — received the VIP floppy',
    tokenId: 20010,
    category: 'holder',
  },
  {
    id: 'vip_access',
    name: 'VIP Access',
    description: 'Used the holder-only shortcut to the basement',
    tokenId: 20011,
    category: 'holder',
  },
  {
    id: 'archivist',
    name: 'Archivist',
    description: 'CRT monitors recognized your Floppy collection',
    tokenId: 20012,
    category: 'holder',
  },
  {
    id: 'alpha_leak',
    name: 'Alpha Leak',
    description: "Found Adrian's backup trading strategies",
    tokenId: 20013,
    category: 'holder',
  },
  {
    id: 'genesis_miner',
    name: 'Genesis Miner',
    description: "Activated the rig's original config",
    tokenId: 20014,
    category: 'holder',
  },
  {
    id: 'sector_zero',
    name: 'Sector Zero',
    description: "Unlocked Adrian's hidden floppy message",
    tokenId: 20015,
    category: 'holder',
  },
  {
    id: 'medical_records',
    name: 'Medical Records',
    description: 'Decrypted the patient database',
    tokenId: 20016,
    category: 'holder',
  },
  {
    id: 'preserved',
    name: 'Preserved',
    description: 'Your floppies hold the story of Patient Zero',
    tokenId: 20017,
    category: 'holder',
  },

  // ─── Explorer / secret ───────────────────────────
  {
    id: 'signal_boost',
    name: 'Signal Boost',
    description: 'Salvaged the rooftop antenna',
    tokenId: 20020,
    category: 'explorer',
  },
];

/** Map from achievement text (as used in scene JSON) to achievement ID */
export const ACHIEVEMENT_TEXT_TO_ID: Record<string, string> = {
  'CHAPTER 1 COMPLETE — Breaking & Entering': 'ch1_complete',
  'Chapter 2 Complete: The Receptionist': 'ch2_complete',
  'Chapter 3 Complete: Below the Surface': 'ch3_complete',
  'Chapter 4 Complete: The Mountain Path': 'ch4_complete',
  'PATIENT ZERO — Identity Revealed': 'patient_zero',
  'GAME COMPLETE: ZEROadventure II': 'game_complete',
  'HOLDER REWARD: VIP Floppy Disc': 'holder_vip_floppy',
  'VIP ACCESS — Found the holder-only shortcut to the basement': 'vip_access',
  'ARCHIVIST — CRT monitors recognized your Floppy collection': 'archivist',
  'ALPHA LEAK — Found Adrian\'s backup trading strategies': 'alpha_leak',
  'GENESIS MINER — Activated the rig\'s original config': 'genesis_miner',
  'SECTOR ZERO — Unlocked Adrian\'s hidden floppy message': 'sector_zero',
  'MEDICAL RECORDS — Decrypted the patient database': 'medical_records',
  'PRESERVED — Your floppies hold the story of Patient Zero': 'preserved',
  'SIGNAL BOOST — Salvaged the rooftop antenna': 'signal_boost',
};

/** Get achievement def by ID */
export function getAchievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}

/** Get achievement def by scene text */
export function getAchievementByText(text: string): AchievementDef | undefined {
  const id = ACHIEVEMENT_TEXT_TO_ID[text];
  return id ? getAchievementById(id) : undefined;
}
