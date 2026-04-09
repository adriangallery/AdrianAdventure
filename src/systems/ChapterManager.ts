/**
 * ChapterManager — Pure data/logic module for chapter definitions and helpers.
 * No Phaser imports. No UI. Just chapter definitions and query methods.
 *
 * The game is divided into 5 chapters, each gated by the previous chapter's
 * completion flag stored in GameState.flags.
 */

export interface ChapterDef {
  id: number;
  title: string;
  subtitle: string;
  scenes: string[];
  /** Intro narrative lines shown before the chapter starts */
  introLines: string[];
  /** Flag set when chapter is completed */
  completionFlag: string;
  /** Flag required to enter this chapter (from previous chapter) */
  gateFlag: string | null;
  /** Achievement text shown on completion */
  achievementText: string;
  /** Collectible IDs available in this chapter */
  collectibles: string[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 1,
    title: "Breaking & Entering",
    subtitle: "Someone left in a hurry...",
    scenes: ["outside"],
    introLines: [
      "Adrian, creator of the ZERO ecosystem, has disappeared.",
      "His laboratory sits abandoned. The servers still hum.",
      "An anonymous message brought you here:",
      "\"The ecosystem is in danger. Go to the lab.\"",
      "\"The door is not as locked as it seems.\"",
    ],
    completionFlag: "chapter_1_complete",
    gateFlag: null,
    achievementText: "Chapter 1 Complete: Breaking & Entering",
    collectibles: ["mystery_envelope"],
  },
  {
    id: 2,
    title: "The Receptionist",
    subtitle: "Trust is earned, not minted.",
    scenes: ["lobby", "upstairs", "rooftop"],
    introLines: [
      "Inside the lab, the air smells of burnt circuits and ambition.",
      "Only the receptionist remains at her post.",
      "Adrian's empire stretches upward \u2014 trading floors, antennas, dreams.",
      "But something downstairs keeps blinking...",
    ],
    completionFlag: "chapter_2_complete",
    gateFlag: "chapter_1_complete",
    achievementText: "Chapter 2 Complete: The Receptionist",
    collectibles: ["golden_token", "monkey_sticker"],
  },
  {
    id: 3,
    title: "Below the Surface",
    subtitle: "Every server has secrets.",
    scenes: ["basement", "server_room"],
    introLines: [
      "Beneath the lab, forgotten machines still process blocks.",
      "A CRT monitor flickers with data from another era.",
      "The patient roster... the escape... Patient Zero.",
      "The answers are down here. Buried in code.",
    ],
    completionFlag: "chapter_3_complete",
    gateFlag: "chapter_2_complete",
    achievementText: "Chapter 3 Complete: Below the Surface",
    collectibles: ["server_log", "burned_chip"],
  },
  {
    id: 4,
    title: "The Mountain Path",
    subtitle: "The clinic is always open.",
    scenes: ["mountain", "clinic_exterior", "clinic_interior"],
    introLines: [
      "The printout shows coordinates. A clinic in the mountains.",
      "\"Patient Zero Rehabilitation Clinic \u2014 Est. Block 0\"",
      "Dr. Satoshi runs the operation. Treats on-chain addiction.",
      "But Patient Zero escaped. And you're getting closer to finding out why.",
    ],
    completionFlag: "chapter_4_complete",
    gateFlag: "chapter_3_complete",
    achievementText: "Chapter 4 Complete: The Mountain Path",
    collectibles: ["dr_satoshi_badge", "clinic_photo"],
  },
  {
    id: 5,
    title: "Patient Zero",
    subtitle: "The blockchain doesn't lie.",
    scenes: ["treatment_room", "epilogue_outside"],
    introLines: [
      "The treatment room. One chair. One monitor.",
      "Dr. Satoshi said not everyone is ready for what's inside.",
      "The truth about Patient Zero...",
      "...has been in your wallet all along.",
    ],
    completionFlag: "chapter_5_complete",
    gateFlag: "chapter_4_complete",
    achievementText: "GAME COMPLETE: Patient Zero",
    collectibles: ["adrian_note"],
  },
];

export class ChapterManager {
  /** Get the chapter definition for a given scene */
  static getChapterForScene(sceneId: string): ChapterDef | undefined {
    return CHAPTERS.find((ch) => ch.scenes.includes(sceneId));
  }

  /** Get chapter by ID */
  static getChapter(chapterId: number): ChapterDef | undefined {
    return CHAPTERS.find((ch) => ch.id === chapterId);
  }

  /** Check if a chapter is unlocked based on game flags */
  static isChapterUnlocked(
    chapterId: number,
    flags: Record<string, boolean>,
  ): boolean {
    const chapter = ChapterManager.getChapter(chapterId);
    if (!chapter) return false;
    // Chapter 1 is always unlocked (no gate)
    if (chapter.gateFlag === null) return true;
    return !!flags[chapter.gateFlag];
  }

  /**
   * Check if entering this scene triggers a new chapter intro.
   * Returns the chapter if this scene is the FIRST scene in a chapter
   * AND the chapter intro hasn't been shown yet.
   * Uses flag: `chapter_N_intro_shown`
   */
  static shouldShowChapterIntro(
    sceneId: string,
    flags: Record<string, boolean>,
  ): ChapterDef | null {
    const chapter = ChapterManager.getChapterForScene(sceneId);
    if (!chapter) return null;

    // Only trigger on the first scene of the chapter
    if (chapter.scenes[0] !== sceneId) return null;

    // Check if intro was already shown
    const introFlag = `chapter_${chapter.id}_intro_shown`;
    if (flags[introFlag]) return null;

    // Check if the chapter is unlocked
    if (!ChapterManager.isChapterUnlocked(chapter.id, flags)) return null;

    return chapter;
  }

  /** Get the opening premise lines (shown at very first game start) */
  static getPremise(): string[] {
    return [
      "Somewhere on Base chain, block 18,247,391...",
      "",
      "The ZERO ecosystem thrives. Tokens flow.",
      "NFTs trade. The FloorEngine sweeps.",
      "",
      "But its creator has vanished.",
      "",
      'They call the missing person "Patient Zero" \u2014',
      "the first crypto addict, the original degen.",
      "",
      "A message arrives in your wallet:",
      '"Find Patient Zero. Save the ecosystem."',
      "",
      "You trace the signal to a house on the outskirts of town...",
    ];
  }

  /**
   * Get current chapter number based on flags.
   * Returns the highest unlocked-but-not-completed chapter,
   * or the last chapter if all are complete.
   */
  static getCurrentChapter(flags: Record<string, boolean>): number {
    for (let i = CHAPTERS.length - 1; i >= 0; i--) {
      const ch = CHAPTERS[i];
      if (flags[ch.completionFlag]) {
        // This chapter is complete; current chapter is the next one (if it exists)
        const nextId = ch.id + 1;
        const nextChapter = ChapterManager.getChapter(nextId);
        return nextChapter ? nextId : ch.id;
      }
    }
    // No chapter completed yet — player is on chapter 1
    return 1;
  }

  /**
   * Get completion percentage (0-100) based on completed chapters.
   */
  static getCompletionPercent(flags: Record<string, boolean>): number {
    const total = CHAPTERS.length;
    let completed = 0;
    for (const ch of CHAPTERS) {
      if (flags[ch.completionFlag]) {
        completed++;
      }
    }
    return Math.round((completed / total) * 100);
  }
}
