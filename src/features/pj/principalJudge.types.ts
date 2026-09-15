// src/types/principalJudge.types.ts

/** A judge who has served (or is serving) as Principal Judge of the ELC. */
export interface PrincipalJudge {
  id: string;
  /** Full judicial title, e.g. "Hon. Lady Justice Lydia Achode, JA" */
  name: string;
  /** e.g. "2018 – 2022" or "2022 – Present" */
  tenure: string;
  /** Court station / posting, e.g. "Environment and Land Court - Naivasha" */
  station?: string;
  /** One-paragraph summary shown on the card */
  shortBio: string;
  /** Full biography shown in the modal */
  fullBio: string;
  /** Bullet list of key administrative milestones */
  keyContributions: string[];
  /** Portrait image URL (may be empty string) */
  image: string;
  /** True for the currently-serving Principal Judge */
  isCurrent?: boolean;
}

/** Response shape when listing previous Principal Judges. */
export interface PrincipalJudgeListResponse {
  data: PrincipalJudge[];
  total: number;
}